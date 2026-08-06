"""
Memory tool — Phase 3, Task 1. First real tool in TOOL_REGISTRY.

Deliberately simple: one row per (workspace_id, user_id) in agent_memory
(migration 015), holding a JSONB array of provenance-tagged entries. Not
a vector-search system -- the planner (once it exists) reads the whole
array and reasons over it directly, since a single user's durable
context is expected to stay small (preferences, ongoing projects, a
handful of durable facts), not the kind of corpus that needs retrieval.

Provenance ("source": "user_stated" | "agent_inferred") is required on
every write. This module does NOT enforce confirmation-gating on
agent_inferred writes -- that's the agent loop's job (Stage 4, not built
yet) to check before calling this tool for that case. What this module
guarantees is that the distinction is never lost: you cannot write an
entry without declaring which one it is.

Importing this module registers both tools as a side effect (see the
register_tool() calls at the bottom) -- there's no separate "activate"
step. Whatever eventually builds the Stage 4 loop just needs to import
this module (directly, or transitively) before reading TOOL_REGISTRY.
"""
import json
from datetime import datetime, timezone

import structlog

from app.db.postgres import get_pool
from app.services.agent_tools import ToolContext, ToolResult, ToolSpec, register_tool

log = structlog.get_logger()

VALID_SOURCES = ("user_stated", "agent_inferred", "conversation_digest")
MAX_MEMORY_ENTRIES = 120


async def append_memory_entry(
    workspace_id: str,
    user_id: str,
    text: str,
    source: str = "conversation_digest",
) -> dict:
    """
    Direct append used by the copilot router for automatic conversation
    digests (no confirm gate). Also used by memory_write after approval.
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("text is required")
    if source not in VALID_SOURCES:
        raise ValueError(f"source must be one of {VALID_SOURCES}")

    entry = {
        "text": text,
        "source": source,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT content FROM agent_memory WHERE workspace_id=$1 AND user_id=$2",
            workspace_id, user_id,
        )
        existing = []
        if row is not None:
            raw = row["content"]
            existing = raw if isinstance(raw, list) else json.loads(raw)
        existing.append(entry)
        if len(existing) > MAX_MEMORY_ENTRIES:
            # Drop oldest conversation digests first, then trim from the front
            while len(existing) > MAX_MEMORY_ENTRIES:
                dig_idx = next((i for i, e in enumerate(existing) if e.get("source") == "conversation_digest"), None)
                if dig_idx is not None:
                    existing.pop(dig_idx)
                else:
                    existing = existing[-MAX_MEMORY_ENTRIES:]
                    break
        await conn.execute(
            """
            INSERT INTO agent_memory (workspace_id, user_id, content)
            VALUES ($1, $2, $3::jsonb)
            ON CONFLICT (workspace_id, user_id)
            DO UPDATE SET content = $3::jsonb
            """,
            workspace_id, user_id, json.dumps(existing),
        )
    return entry


async def _memory_read_execute(args: dict, ctx: ToolContext) -> ToolResult:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT content FROM agent_memory WHERE workspace_id=$1 AND user_id=$2",
            ctx.workspace_id, ctx.user_id,
        )
    if row is None:
        return ToolResult(success=True, content=[])
    raw = row["content"]
    entries = raw if isinstance(raw, list) else json.loads(raw)
    return ToolResult(success=True, content=entries)


async def _memory_write_execute(args: dict, ctx: ToolContext) -> ToolResult:
    text = (args.get("text") or "").strip()
    source = args.get("source")
    if not text:
        return ToolResult(success=False, error="text is required and cannot be empty")
    if source not in ("user_stated", "agent_inferred"):
        return ToolResult(success=False, error=f"source must be one of ['user_stated', 'agent_inferred'], got {source!r}")

    try:
        entry = await append_memory_entry(ctx.workspace_id, ctx.user_id, text, source=source)
    except Exception as e:
        return ToolResult(success=False, error=str(e))
    log.info("memory_write", workspace_id=ctx.workspace_id, user_id=ctx.user_id, source=source)
    return ToolResult(success=True, content=entry)


MEMORY_READ_TOOL = ToolSpec(
    name="memory_read",
    description=(
        "Fetch what's already known about this user from persistent memory -- "
        "ongoing projects, stated preferences, durable context from past "
        "interactions. Call this before acting on a goal, to check existing "
        "context rather than asking the user to repeat themselves."
    ),
    kind="sync",
    input_schema={"type": "object", "properties": {}},
    execute=_memory_read_execute,
)

MEMORY_WRITE_TOOL = ToolSpec(
    name="memory_write",
    description=(
        "Append a durable fact to persistent memory. Only for information "
        "that should persist across conversations (a stated preference, an "
        "ongoing project detail) -- not transient task state. Must declare "
        "source: 'user_stated' if the user explicitly said this, or "
        "'agent_inferred' if the agent worked it out on its own -- "
        "agent_inferred facts require the user's confirmation before being "
        "trusted, which the calling loop is responsible for obtaining."
    ),
    kind="sync",
    input_schema={
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "The durable fact to remember, in plain language."},
            "source": {
                "type": "string",
                "enum": list(VALID_SOURCES),
                "description": "Whether the user explicitly stated this, or the agent inferred it.",
            },
        },
        "required": ["text", "source"],
    },
    execute=_memory_write_execute,
)

register_tool(MEMORY_READ_TOOL)
register_tool(MEMORY_WRITE_TOOL)
