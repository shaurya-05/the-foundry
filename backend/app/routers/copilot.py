import asyncio
import json
import re
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from app.auth import decode_token
from jose import JWTError
from app.models.schemas import CopilotMessage, IntentRequest, IntentResponse
from app.services.claude import stream_claude
from app.services.ai_router import route_query, get_council_perspectives, estimate_tokens
from app.services.context_engine import get_workspace_summary, build_copilot_system, build_project_copilot_system
from app.services.usage import check_limit, increment_usage
from app.services.agent_tools import resolve_pending_call, create_pending_call, await_frontend_response, ToolContext
from app.services.agent_loop import run_agent_loop
from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth

log = structlog.get_logger()

# History budget for multi-turn context. This deployment runs local
# Ollama models with a real ~4096-token context window total (see
# ai_router.py's route_query docstring), shared between system prompt,
# tool definitions, history, the new message, and room for the reply --
# NOT a large cloud-model window. A wide budget here doesn't make H3RO
# remember more; Ollama truncates from the front once the real window
# fills, silently dropping the system prompt (H3RO's own persona) and the
# earliest turns first -- the opposite of "remembers the conversation".
# 100 messages stays as an outer sanity cap; the token budget is what
# actually bites in practice for any thread with real content.
MAX_HISTORY_MESSAGES = 100
MAX_HISTORY_TOKENS = 1800
# Compact digest of OTHER threads so a new chat can pick up without
# dumping every prior turn into the model window.
CROSS_THREAD_DIGEST_TOKENS = 700
CROSS_THREAD_MSG_CAP = 24


async def _load_thread_history(conn, thread_id: str, workspace_id: str) -> list[dict]:
    """
    Prior turns in a thread, oldest first, bounded by count and a rough
    token budget (trims from the oldest first when over budget) so a
    long-running thread can't blow the model's context window.
    """
    rows = await conn.fetch(
        """SELECT role, content FROM copilot_messages
           WHERE thread_id = $1 AND workspace_id = $2 AND role IN ('user', 'assistant')
           ORDER BY created_at DESC LIMIT $3""",
        thread_id, workspace_id, MAX_HISTORY_MESSAGES,
    )
    history = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    total = sum(estimate_tokens(m["content"]) for m in history)
    while history and total > MAX_HISTORY_TOKENS:
        total -= estimate_tokens(history[0]["content"])
        history.pop(0)
    return history


async def _load_cross_thread_digest(
    conn,
    workspace_id: str,
    user_id: str,
    exclude_thread_id: Optional[str] = None,
) -> str:
    """
    Short rolling digest of recent turns from other H3RO threads so a new
    conversation can continue without the founder re-explaining context.
    Excludes the active thread (already covered by thread history).
    """
    rows = await conn.fetch(
        """
        SELECT thread_id, role, content, created_at
        FROM copilot_messages
        WHERE workspace_id = $1
          AND user_id = $2
          AND role IN ('user', 'assistant')
          AND thread_id IS NOT NULL
          AND ($3::uuid IS NULL OR thread_id <> $3::uuid)
        ORDER BY created_at DESC
        LIMIT $4
        """,
        workspace_id, user_id, exclude_thread_id, CROSS_THREAD_MSG_CAP,
    )
    if not rows:
        return ""

    # Group newest-first into thread buckets, then reverse each for reading order
    by_thread: dict[str, list] = {}
    order: list[str] = []
    for r in rows:
        tid = str(r["thread_id"])
        if tid not in by_thread:
            by_thread[tid] = []
            order.append(tid)
        by_thread[tid].append(r)

    lines: list[str] = []
    total = 0
    for tid in order:
        turns = list(reversed(by_thread[tid]))
        title = next((t["content"][:80].replace("\n", " ") for t in turns if t["role"] == "user"), "Untitled")
        block = [f"### Prior chat · {title}"]
        for t in turns[-6:]:
            role = "Founder" if t["role"] == "user" else "H3RO"
            snippet = (t["content"] or "").strip().replace("\n", " ")
            if len(snippet) > 280:
                snippet = snippet[:277] + "…"
            # Surface attachment / file references that were inlined
            if "[Attached" in (t["content"] or "") or "Attached file:" in (t["content"] or ""):
                snippet = snippet[:200] + " [had file/upload reference]"
            line = f"- {role}: {snippet}"
            cost = estimate_tokens(line)
            if total + cost > CROSS_THREAD_DIGEST_TOKENS:
                break
            block.append(line)
            total += cost
        if len(block) > 1:
            lines.extend(block)
        if total >= CROSS_THREAD_DIGEST_TOKENS:
            break

    if not lines:
        return ""
    return (
        "Prior H3RO conversations (other threads). Use these to continue "
        "seamlessly — do not ask the founder to repeat what is already here.\n\n"
        + "\n".join(lines)
    )


async def _append_conversation_memory(
    workspace_id: str,
    user_id: str,
    user_message: str,
    assistant_answer: str,
    thread_id: str,
) -> None:
    """
    Persist a short handoff note after each completed turn so durable
    memory stays warm even when the founder starts a brand-new chat.
    Bypasses the confirm gate — these are system digests, not inferred secrets.
    """
    from app.services.memory_tool import append_memory_entry

    u = (user_message or "").strip().replace("\n", " ")
    a = (assistant_answer or "").strip().replace("\n", " ")
    if len(u) > 220:
        u = u[:217] + "…"
    if len(a) > 320:
        a = a[:317] + "…"
    if not u or not a:
        return
    text = f"Thread {thread_id[:8]}… · Founder asked: {u} · H3RO: {a}"
    try:
        await append_memory_entry(workspace_id, user_id, text, source="conversation_digest")
    except Exception as e:
        log.warning("conversation_memory_append_failed", error=str(e)[:200])


async def _maybe_learn_h3ro_style(user_id: str, user_message: str) -> None:
    """Phase 11 — post-turn style detection (no confirm gate; fail-closed)."""
    try:
        from app.services.h3ro_style import maybe_update_h3ro_style_from_message

        await maybe_update_h3ro_style_from_message(user_id, user_message)
    except Exception as e:
        log.warning("h3ro_style_hook_failed", error=str(e)[:200])


# Max time we wait AFTER the primary answer completes for the council task
# to finish. Council is fire-and-forget from the primary stream's POV —
# never blocks a text_delta yield.
COUNCIL_WAIT_S = 10.0

router = APIRouter(prefix="/api/copilot", tags=["copilot"])

INTENT_PATTERNS = [
    (r"\b(run|use|deploy|launch)\s+(field analyst|systems architect|market scout|launch strategist)\b", "run_agent"),
    (r"\b(run|start|execute)\s+(pipeline|deep recon|launch readiness|full forge|blueprint)\b", "run_pipeline"),
    (r"\b(create|add|make)\s+(a\s+)?(task|todo)\b", "create_task"),
    (r"\b(create|start|new)\s+(a\s+)?(project|build)\b", "create_project"),
    (r"\b(go to|open|navigate|show me)\s+(knowledge|archive|projects|workshop|ideas|crucible|tasks|runsheet|agents|crew|workspace|blueprint|launchpad|context|signal)\b", "navigate"),
    (r"\b(status|overview|how many|what's in|workspace)\b", "workspace_status"),
    (r"\b(find|search|connect|link|related|relationship)\b", "find_connections"),
    (r"\b(analyze|deep dive|review|breakdown|evaluate)\s+(project|build)\b", "analyze_project"),
]


async def _authenticate_ws(websocket: WebSocket) -> Optional[AuthContext]:
    """
    WebSocket equivalent of require_auth(). Browsers' native WebSocket API
    has no way to set a custom Authorization header on the handshake
    request, so auth here comes from the first message sent AFTER
    connecting, not an HTTP header. Returns None (having already closed
    the socket) on any auth failure -- callers should just return.
    """
    try:
        first = await websocket.receive_json()
    except Exception:
        await websocket.close(code=1008, reason="expected an auth message")
        return None
    token = first.get("token")
    if not token:
        await websocket.close(code=1008, reason="missing token")
        return None
    try:
        payload = decode_token(token, expected_type="access")
    except JWTError:
        await websocket.close(code=1008, reason="invalid or expired token")
        return None
    return AuthContext(user_id=payload["sub"], workspace_id=payload["workspace_id"], email=payload["email"]), first


@router.websocket("/message")
async def copilot_message_ws(websocket: WebSocket):
    """
    WebSocket replacement for the old POST /message SSE endpoint -- see
    the module-level note above _authenticate_ws for why. Found, via a
    real production Cloudflare Tunnel test, that SSE responses through
    the tunnel get buffered by Cloudflare's edge until the connection
    closes, regardless of compression, Cache-Control, Content-Type exact
    match, or any of three different Cloudflare dashboard settings tried
    (Page Rule "Disable Performance", Configuration Rule "Response Body
    Buffering" off, no-transform) -- a longstanding, apparently
    unresolved cloudflared/Cloudflare-edge limitation (see
    cloudflare/cloudflared#199, open since 2020). WebSocket connections
    are proxied by Cloudflare as raw bidirectional streams, a genuinely
    different code path not subject to that HTTP-response buffering.

    Protocol: client connects, then sends ONE JSON message combining
    auth + the request ({"token", "message", "thread_id"?, "project_id"?,
    "model_override"?}). Server streams back the same event shapes the
    old SSE endpoint sent (as JSON text frames instead of `data: ...`
    lines), then closes the socket -- one connection per message, same
    per-request shape the frontend already used via streamSSE(), not a
    persistent multi-turn session.
    """
    await websocket.accept()
    auth_result = await _authenticate_ws(websocket)
    if auth_result is None:
        return
    auth, first_msg = auth_result

    try:
        req = CopilotMessage(**{k: v for k, v in first_msg.items() if k != "token"})
    except Exception as e:
        await websocket.send_json({"type": "error", "message": f"bad request: {e}"})
        await websocket.close(code=1003)
        return

    if not await check_limit(auth.workspace_id, 'copilot_messages'):
        await websocket.send_json({
            "type": "error",
            "message": "limit_exceeded",
        })
        await websocket.close(code=1008, reason="limit_exceeded")
        return

    pool = await get_pool()

    import uuid as _uuid
    thread_id = req.thread_id or str(_uuid.uuid4())
    async with pool.acquire() as conn:
        history = await _load_thread_history(conn, thread_id, auth.workspace_id) if req.thread_id else []
        # Always load a digest of other threads so new chats pick up prior context
        cross_digest = await _load_cross_thread_digest(
            conn, auth.workspace_id, auth.user_id, exclude_thread_id=thread_id,
        )
        await conn.execute(
            "INSERT INTO copilot_messages (workspace_id, user_id, role, content, project_id, thread_id) VALUES ($1, $2, 'user', $3, $4, $5)",
            auth.workspace_id, auth.user_id, req.message, req.project_id, thread_id,
        )

    if req.agent_mode:
        await increment_usage(auth.workspace_id, 'copilot_messages')
        await websocket.send_json({'type': 'thread_id', 'thread_id': thread_id})
        ctx = ToolContext(workspace_id=auth.workspace_id, user_id=auth.user_id, thread_id=thread_id)
        final_text = ""
        try:
            async for event in run_agent_loop(
                req.message, ctx, history=history, cross_thread_context=cross_digest or None,
            ):
                await websocket.send_json(event)
                if event["type"] == "agent_final":
                    final_text = event["answer"]
                elif event["type"] == "agent_stopped":
                    final_text = event["partial_answer"]
            await websocket.send_json({"type": "done"})
            if final_text:
                async with pool.acquire() as conn:
                    await conn.execute(
                        "INSERT INTO copilot_messages (workspace_id, user_id, role, content, project_id, model_used, thread_id) VALUES ($1, $2, 'assistant', $3, $4, $5, $6)",
                        auth.workspace_id, auth.user_id, final_text, req.project_id, "agent-loop", thread_id,
                    )
                await _append_conversation_memory(
                    auth.workspace_id, auth.user_id, req.message, final_text, thread_id,
                )
                await _maybe_learn_h3ro_style(auth.user_id, req.message)
        except WebSocketDisconnect:
            log.info("copilot_ws_client_disconnected", thread_id=thread_id, agent_mode=True)
        finally:
            try:
                await websocket.close()
            except Exception:
                pass
        return

    if req.project_id:
        from app.services.h3ro_style import get_user_h3ro_style
        _style = await get_user_h3ro_style(auth.user_id)
        system = await build_project_copilot_system(
            req.project_id, auth.workspace_id, h3ro_style=_style,
        )
    else:
        from app.services.h3ro_style import get_user_h3ro_style
        summary = await get_workspace_summary(auth.workspace_id)
        _style = await get_user_h3ro_style(auth.user_id)
        system = build_copilot_system(summary, h3ro_style=_style)

    try:
        await increment_usage(auth.workspace_id, 'copilot_messages')
        full_text = []
        model_used = "claude-sonnet-4"
        first = True

        await websocket.send_json({'type': 'thread_id', 'thread_id': thread_id})

        status_q: asyncio.Queue = asyncio.Queue()

        async def _on_status(text: str) -> None:
            await status_q.put(text)

        council_task = asyncio.create_task(
            get_council_perspectives(system, req.message)
        )

        async for chunk in route_query(
            system, req.message, max_tokens=1200,
            model_override=req.model_override,
            on_status=_on_status,
            history=history,
            workspace_id=auth.workspace_id,
        ):
            while not status_q.empty():
                st = status_q.get_nowait()
                await websocket.send_json({'type': 'status', 'text': st})

            if first:
                model_used = chunk
                first = False
                await websocket.send_json({'type': 'model_used', 'model': model_used})
                continue
            if isinstance(chunk, tuple) and chunk[0] == "model_used":
                model_used = chunk[1]
                await websocket.send_json({'type': 'model_used', 'model': model_used})
                continue
            full_text.append(chunk)
            await websocket.send_json({"type": "text_delta", "text": chunk})

        while not status_q.empty():
            await websocket.send_json({'type': 'status', 'text': status_q.get_nowait()})

        try:
            if not council_task.done():
                await websocket.send_json({'type': 'status', 'text': 'gathering second opinions...'})
            perspectives = await asyncio.wait_for(council_task, timeout=COUNCIL_WAIT_S)
            if perspectives:
                await websocket.send_json({'type': 'council', 'perspectives': perspectives})
        except asyncio.TimeoutError:
            log.info("council_timeout", thread_id=thread_id, wait_s=COUNCIL_WAIT_S)
            council_task.cancel()
        except Exception as e:
            log.warning("council_error", thread_id=thread_id, error=str(e)[:200])

        await websocket.send_json({"type": "done"})
        assistant_text = "".join(full_text)
        if assistant_text:
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO copilot_messages (workspace_id, user_id, role, content, project_id, model_used, thread_id) VALUES ($1, $2, 'assistant', $3, $4, $5, $6)",
                    auth.workspace_id, auth.user_id, assistant_text, req.project_id, model_used, thread_id,
                )
            await _maybe_learn_h3ro_style(auth.user_id, req.message)
    except WebSocketDisconnect:
        log.info("copilot_ws_client_disconnected", thread_id=thread_id)
        return
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@router.post("/tool-result")
async def submit_tool_result(req: dict, auth: AuthContext = Depends(require_auth)):
    """
    The frontend half of an async_frontend tool's round-trip (see
    agent_tools.py's module docstring for the full protocol). The
    frontend POSTs here with the call_id it received in a `tool_request`
    SSE event, plus whatever result it produced (e.g. real file content
    read via the File System Access API). This resolves the asyncio
    Future the agent loop is awaiting, in the SAME original /message
    request -- it does not start a new AI turn.
    """
    call_id = req.get("call_id")
    if not call_id:
        raise HTTPException(status_code=400, detail="call_id required")
    accepted = resolve_pending_call(call_id, auth.workspace_id, req)
    if not accepted:
        # Not an error the frontend needs to retry on -- most commonly
        # means the loop already timed out waiting and moved on.
        return {"accepted": False, "reason": "unknown call_id, wrong workspace, or already resolved"}
    return {"accepted": True}


@router.websocket("/_test_file_tool")
async def test_file_tool_ws(websocket: WebSocket):
    """
    Stage-3 isolation-test scaffold ONLY, now WebSocket -- see
    copilot_message_ws's docstring for why SSE was abandoned for this
    transport (Cloudflare Tunnel buffers the whole response until
    connection close, confirmed independent of compression/headers/three
    different dashboard settings). Exercises the real async_frontend
    round-trip for list_files/read_file with a real connected browser,
    without the Stage-4 agent loop existing yet. Sends one `tool_request`
    message, then periodic heartbeat messages while awaiting the
    frontend's real response (or the timeout), then the final result.
    Not meant to survive once the real loop can drive this itself --
    remove when Stage 4 lands.
    """
    await websocket.accept()
    auth_result = await _authenticate_ws(websocket)
    if auth_result is None:
        return
    auth, first_msg = auth_result

    tool_name = first_msg.get("tool")
    args = first_msg.get("args") or {}
    if tool_name not in ("list_files", "read_file"):
        await websocket.send_json({"type": "error", "message": "tool must be list_files or read_file"})
        await websocket.close(code=1003)
        return

    try:
        call_id, future = create_pending_call(auth.workspace_id)
        await websocket.send_json({'type': 'tool_request', 'call_id': call_id, 'tool': tool_name, 'args': args})
        async for tick in await_frontend_response(call_id, future, tool_name):
            if tick is None:
                await websocket.send_json({'type': 'heartbeat'})
            else:
                await websocket.send_json({'type': 'tool_result', **tick})
        await websocket.send_json({"type": "done"})
    except WebSocketDisconnect:
        return
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@router.get("/history")
async def get_copilot_history(
    project_id: Optional[str] = Query(None),
    thread_id: Optional[str] = Query(None),
    limit: int = 100,
    auth: AuthContext = Depends(require_auth),
):
    """Returns copilot conversation history. Prefer thread_id for H3RO threads."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        if thread_id:
            rows = await conn.fetch(
                """SELECT id, role, content, created_at, model_used FROM copilot_messages
                   WHERE workspace_id=$1 AND thread_id=$2 AND role IN ('user', 'assistant')
                   ORDER BY created_at DESC LIMIT $3""",
                auth.workspace_id, thread_id, limit,
            )
        elif project_id:
            rows = await conn.fetch(
                """SELECT id, role, content, created_at, model_used FROM copilot_messages
                   WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT $3""",
                auth.workspace_id, project_id, limit,
            )
        else:
            rows = await conn.fetch(
                """SELECT id, role, content, created_at, model_used FROM copilot_messages
                   WHERE workspace_id=$1 AND project_id IS NULL ORDER BY created_at DESC LIMIT $2""",
                auth.workspace_id, limit,
            )
        return [
            {
                "id": str(r["id"]),
                "role": r["role"],
                "content": r["content"],
                "created_at": r["created_at"].isoformat(),
                "model_used": r["model_used"],
            }
            for r in reversed(rows)
        ]


@router.post("/intent", response_model=IntentResponse)
async def classify_intent(req: IntentRequest, auth: AuthContext = Depends(require_auth)):
    msg = req.message.lower()
    for pattern, intent in INTENT_PATTERNS:
        if re.search(pattern, msg):
            return IntentResponse(intent=intent, confidence=0.9)
    return IntentResponse(intent="query", confidence=0.7)

@router.get("/threads")
async def get_threads(auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (thread_id) thread_id as id,
                   SUBSTRING(content, 1, 60) as title,
                   created_at
            FROM copilot_messages
            WHERE workspace_id=$1 AND role='user' AND thread_id IS NOT NULL
            ORDER BY thread_id, created_at ASC
            """,
            auth.workspace_id,
        )
    return [{"id": str(r["id"]), "title": r["title"] or "Untitled", "created_at": r["created_at"].isoformat()} for r in rows]

@router.post("/save-to-drive")
async def save_to_drive(req: dict, auth: AuthContext = Depends(require_auth)):
    """Save a COFOUND3R response to Google Drive as a Doc."""
    from app.services.google_drive import create_doc
    title = req.get("title", "COFOUND3R Response")
    content = req.get("content", "")
    if not content:
        raise HTTPException(status_code=400, detail="No content to save")
    try:
        result = await create_doc(auth.workspace_id, auth.user_id, title, content)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
