"""
Agent tool registry — Phase 3, Stage 1.

Every tool the agent loop (Stage 4) can call is registered here, once,
as a ToolSpec. Adding a third tool later means calling register_tool()
somewhere at import time — the loop's core logic never grows a new
if/elif branch per tool. The planner sees tool_definitions_for_planner()'s
output, which is tool-kind-agnostic on purpose: the planner shouldn't need
to know or care whether a tool runs in-process or round-trips to a browser
— that distinction is an execution-time concern for the executor, not a
planning-time one.

Two kinds of tools, because they execute fundamentally differently:

  sync — a normal backend async function call (DB query, computation).
         Runs entirely within the agent loop's own process; nothing
         outside the backend needs to do anything.

  async_frontend — the tool's real execution happens in the BROWSER
         (e.g. reading a file via the File System Access API, which only
         the frontend holding the user's granted FileSystemDirectoryHandle
         can do — the backend has no filesystem access to the user's
         machine at all, by design of that browser API). The backend
         cannot call a function for this; it can only ASK the frontend to
         do it and wait for the answer.

Why "wait" is non-trivial: the agent loop runs inside the same HTTP
request that's streaming SSE to the frontend (same shape as
ai_router.route_query()). SSE is server→client only — the frontend has no
way to push data back over that same connection. So an async_frontend
tool call is a genuine round-trip across two separate HTTP exchanges tied
together by a call_id:

    1. The loop (Stage 4) calls create_pending_call(workspace_id), gets
       back (call_id, future), and yields an SSE event
       {"type": "tool_request", "call_id": ..., "tool": <name>,
        "args": {...}} — copilot.py's existing SSE writer forwards this
       to the browser exactly like any other event.
    2. The frontend receives that event, does the real work (e.g. reads
       the file via the File System Access API), and POSTs the result to
       POST /api/copilot/tool-result with the same call_id.
    3. That endpoint calls resolve_pending_call(call_id, workspace_id,
       payload), which resolves the future from step 1 — waking the
       *original* request's agent loop back up with the real result, via
       plain asyncio, no polling.

This means the agent loop itself has to be an async generator (again,
same shape as route_query()), so it can yield control back to copilot.py
mid-tool-call and later resume from exactly where it paused.

Deployment note: _PENDING_FRONTEND_CALLS is a plain module-level dict —
correct and sufficient because this backend runs as a single Uvicorn
worker process (see backend/Dockerfile's CMD, no --workers flag). If this
ever moves to multiple worker processes, this would need to move to
something shared (Redis pub/sub, most likely) since a tool-result POST
could land on a different worker than the one awaiting the future. Not
solving that now — it isn't this deployment's reality.
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal, Optional

import structlog

log = structlog.get_logger()

ToolKind = Literal["sync", "async_frontend"]


@dataclass
class ToolContext:
    """Scoping info threaded into every sync tool call — who's asking, from where. Not used by async_frontend tools, which carry no execute() to call it from."""
    workspace_id: str
    user_id: str
    thread_id: Optional[str] = None


@dataclass
class ToolResult:
    success: bool
    content: Any = None
    error: Optional[str] = None


@dataclass
class ToolSpec:
    name: str
    description: str               # what the planner reads to decide when to use this
    input_schema: dict[str, Any]   # JSON schema "parameters" object, same shape as ai_router.WEB_SEARCH_TOOL
    kind: ToolKind
    # Required for kind="sync". Must be omitted for kind="async_frontend"
    # — that tool has no backend implementation to call; its real
    # execution is in the browser, reached via the round-trip below.
    execute: Optional[Callable[[dict, ToolContext], Awaitable[ToolResult]]] = None
    # Only meaningful for kind="async_frontend": how long the loop waits
    # for the browser's response before giving up.
    frontend_timeout_s: float = 15.0  # keep in sync with DEFAULT_FRONTEND_TIMEOUT_S below

    def __post_init__(self):
        if self.kind == "sync" and self.execute is None:
            raise ValueError(f"sync tool {self.name!r} must provide execute")
        if self.kind == "async_frontend" and self.execute is not None:
            raise ValueError(
                f"async_frontend tool {self.name!r} must not provide execute "
                "— it has no backend implementation, only a frontend round-trip"
            )


TOOL_REGISTRY: dict[str, ToolSpec] = {}


def register_tool(spec: ToolSpec) -> None:
    if spec.name in TOOL_REGISTRY:
        log.warning("tool_reregistered", name=spec.name)
    TOOL_REGISTRY[spec.name] = spec


def tool_definitions_for_planner() -> list[dict]:
    """
    OpenAI-wire-format tool definitions for every registered tool,
    regardless of kind — the planner LLM sees one uniform list and
    decides what to call; it never needs to know a tool is
    frontend-mediated. That distinction is purely an executor-time
    concern (Stage 4).
    """
    return [
        {
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.input_schema,
            },
        }
        for spec in TOOL_REGISTRY.values()
    ]


# ─── Async frontend-mediated round trip ──────────────────────────────────────
# call_id -> (future, owning workspace_id). The workspace_id is checked on
# resolve so one workspace can't resolve (or accidentally collide with)
# another's pending call, even though call_ids are UUIDs and not
# realistically guessable — defense in depth, not the primary guard.

_PENDING_FRONTEND_CALLS: dict[str, tuple[asyncio.Future, str]] = {}


def create_pending_call(workspace_id: str) -> tuple[str, asyncio.Future]:
    call_id = str(uuid.uuid4())
    future: asyncio.Future = asyncio.get_event_loop().create_future()
    _PENDING_FRONTEND_CALLS[call_id] = (future, workspace_id)
    return call_id, future


def resolve_pending_call(call_id: str, workspace_id: str, payload: dict) -> bool:
    """
    Called by POST /api/copilot/tool-result. Returns False (not an
    exception) for any of: unknown call_id, wrong workspace, or a future
    that's already resolved/cancelled — the caller should treat False as
    "nothing to report success on", not a server error, since a stale or
    duplicate POST arriving after a timeout already fired is an expected
    race, not a bug.
    """
    entry = _PENDING_FRONTEND_CALLS.get(call_id)
    if entry is None:
        return False
    future, owner_workspace_id = entry
    if owner_workspace_id != workspace_id or future.done():
        return False
    _PENDING_FRONTEND_CALLS.pop(call_id, None)
    future.set_result(payload)
    return True


def cancel_pending_call(call_id: str) -> None:
    """Cleanup after a timeout or an aborted loop. Safe to call more than once or on an already-resolved/absent call_id -- pop(..., None) never raises."""
    _PENDING_FRONTEND_CALLS.pop(call_id, None)


# Default wait for a frontend round-trip. A real File System Access API
# read is a local disk read once permission is already granted -- near-
# instant in the common case. This just needs to be generous enough for
# a slow permission re-prompt, not so long that a genuinely dead
# frontend (closed tab, crashed browser, revoked permission mid-flight)
# hangs the whole agent loop for minutes. Per-tool override available via
# ToolSpec.frontend_timeout_s.
DEFAULT_FRONTEND_TIMEOUT_S = 15.0


async def await_frontend_response(
    call_id: str,
    future: asyncio.Future,
    tool_name: str,
    timeout_s: float = DEFAULT_FRONTEND_TIMEOUT_S,
) -> dict:
    """
    Await a pending async_frontend call with a timeout. NEVER raises on
    timeout -- always returns a plain dict, so the executor/reflector
    (Stage 4+) can reason about a timeout as just another tool outcome
    ("continue without this file") rather than an exception that kills
    the whole request.

    On timeout: calls cancel_pending_call(), which pops call_id out of
    _PENDING_FRONTEND_CALLS. That's what makes a late-arriving POST to
    /api/copilot/tool-result correctly get rejected afterward --
    resolve_pending_call() looks the call_id up in that same dict, finds
    nothing, and returns False exactly like it would for any unknown
    call_id. There's no separate "expired" bookkeeping needed; removal
    IS the rejection mechanism.

    The trailing `finally` guards a case the try/except doesn't cover:
    if the surrounding request is itself cancelled (e.g. the client
    disconnected) while this await is in flight, asyncio raises
    CancelledError here, which is neither caught nor swallowed --  it
    propagates, exactly as it should, so the request actually tears
    down. But we still don't want to leak the registry entry in that
    case, so cleanup runs regardless of how this coroutine exits.
    """
    try:
        payload = await asyncio.wait_for(future, timeout=timeout_s)
        return {"status": "ok", "tool": tool_name, "call_id": call_id, "result": payload}
    except asyncio.TimeoutError:
        log.warning("frontend_tool_timeout", tool=tool_name, call_id=call_id, timeout_s=timeout_s)
        return {"status": "timeout", "tool": tool_name, "call_id": call_id}
    finally:
        cancel_pending_call(call_id)
