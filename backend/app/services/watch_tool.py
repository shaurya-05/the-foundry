"""
Watch tools — Phase 6b. User-created proactive topic watches.

Importing this module registers create_watch / list_watches / cancel_watch
into TOOL_REGISTRY as a side effect.
"""
from app.services.agent_tools import ToolContext, ToolResult, ToolSpec, register_tool
from app.services import watch_service


async def _create_watch_execute(args: dict, ctx: ToolContext) -> ToolResult:
    query = (args.get("query") or args.get("topic") or "").strip()
    if not query:
        return ToolResult(success=False, error="query is required")
    try:
        watch = await watch_service.create_watch(ctx.workspace_id, ctx.user_id, query)
    except ValueError as e:
        return ToolResult(success=False, error=str(e))
    except Exception as e:
        return ToolResult(success=False, error=str(e))
    return ToolResult(
        success=True,
        content={
            "id": watch["id"],
            "query": watch["query"],
            "created_at": watch["created_at"],
            "note": (
                "Watch created. H3RO will periodically re-check this topic in the "
                "background and leave a quiet notice in Signals if something new appears."
            ),
        },
    )


async def _list_watches_execute(args: dict, ctx: ToolContext) -> ToolResult:
    watches = await watch_service.list_watches(ctx.workspace_id, ctx.user_id)
    return ToolResult(
        success=True,
        content={
            "count": len(watches),
            "watches": [
                {
                    "id": w["id"],
                    "query": w["query"],
                    "created_at": w["created_at"],
                    "last_checked_at": w["last_checked_at"],
                    "has_pending_notice": bool(w.get("pending_notice")),
                }
                for w in watches
            ],
        },
    )


async def _cancel_watch_execute(args: dict, ctx: ToolContext) -> ToolResult:
    watch_id = (args.get("watch_id") or args.get("id") or "").strip()
    query = (args.get("query") or args.get("topic") or "").strip()

    if not watch_id and query:
        watches = await watch_service.list_watches(ctx.workspace_id, ctx.user_id)
        matches = [w for w in watches if w["query"].lower() == query.lower()]
        if not matches:
            matches = [w for w in watches if query.lower() in w["query"].lower()]
        if len(matches) == 1:
            watch_id = matches[0]["id"]
        elif len(matches) > 1:
            return ToolResult(
                success=False,
                error="Multiple watches match that query — pass watch_id to cancel one.",
                content={"matches": [{"id": m["id"], "query": m["query"]} for m in matches]},
            )
        else:
            return ToolResult(success=False, error="No active watch matched that query.")

    if not watch_id:
        return ToolResult(success=False, error="watch_id or query is required")

    cancelled = await watch_service.cancel_watch(ctx.workspace_id, ctx.user_id, watch_id)
    if cancelled is None:
        return ToolResult(success=False, error="Watch not found or already cancelled")
    return ToolResult(
        success=True,
        content={"id": cancelled["id"], "query": cancelled["query"], "cancelled": True},
    )


CREATE_WATCH_TOOL = ToolSpec(
    name="create_watch",
    description=(
        "Start watching a topic or question in the background. H3RO will "
        "periodically re-check the live web for it and leave a quiet notice "
        "(not spoken) when something meaningfully new appears. Use when the "
        "founder says things like “watch for news about X” or “keep an eye on Y.”"
    ),
    kind="sync",
    input_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The topic or question to watch, e.g. 'Series A AI funding news'.",
            },
        },
        "required": ["query"],
    },
    execute=_create_watch_execute,
)

LIST_WATCHES_TOOL = ToolSpec(
    name="list_watches",
    description="List the founder's active background watches and whether any have a pending notice.",
    kind="sync",
    input_schema={"type": "object", "properties": {}},
    execute=_list_watches_execute,
)

CANCEL_WATCH_TOOL = ToolSpec(
    name="cancel_watch",
    description="Stop an active watch by watch_id (preferred) or by matching query text.",
    kind="sync",
    input_schema={
        "type": "object",
        "properties": {
            "watch_id": {
                "type": "string",
                "description": "ID returned by create_watch / list_watches.",
            },
            "query": {
                "type": "string",
                "description": "Topic text to match if watch_id is unknown.",
            },
        },
    },
    execute=_cancel_watch_execute,
)

register_tool(CREATE_WATCH_TOOL)
register_tool(LIST_WATCHES_TOOL)
register_tool(CANCEL_WATCH_TOOL)
