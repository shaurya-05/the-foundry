"""
Web search tool for H3RO / agent mode — wraps Tavily so the agent can
look things up like a normal assistant (news, facts, current events).
"""
from app.services.agent_tools import ToolContext, ToolResult, ToolSpec, register_tool
from app.services import web_search


async def _web_search_execute(args: dict, ctx: ToolContext) -> ToolResult:
    query = (args.get("query") or "").strip()
    if not query:
        return ToolResult(success=False, error="query is required")
    if not web_search.is_configured():
        return ToolResult(
            success=False,
            error="Web search is not configured (missing TAVILY_API_KEY).",
        )
    results = await web_search.search(query, max_results=5)
    if not results:
        return ToolResult(
            success=True,
            content={"query": query, "results": [], "note": "No results returned."},
        )
    return ToolResult(success=True, content={"query": query, "results": results})


WEB_SEARCH_TOOL = ToolSpec(
    name="web_search",
    description=(
        "Search the live internet for current information — news, facts, "
        "docs, market data, anything a normal AI assistant would look up. "
        "Use this when the answer needs up-to-date or external knowledge "
        "that is not in the founder's files or workspace memory."
    ),
    kind="sync",
    input_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query — be specific.",
            },
        },
        "required": ["query"],
    },
    execute=_web_search_execute,
)

register_tool(WEB_SEARCH_TOOL)
