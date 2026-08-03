"""
Real web search for the RESEARCH tier, via Tavily (purpose-built for
LLM/agent tool-use — returns clean pre-extracted content, not raw HTML).

Free tier: 1,000 searches/month. Get a key at https://tavily.com.
"""
import os

import httpx
import structlog

log = structlog.get_logger()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
TAVILY_URL = "https://api.tavily.com/search"


def is_configured() -> bool:
    return bool(TAVILY_API_KEY)


async def search(query: str, max_results: int = 5) -> list[dict]:
    """
    Returns [] on any failure (missing key, network error, rate limit,
    bad response shape) rather than raising -- callers must treat an
    empty list as "search unavailable" and fall back to the honest
    "I can't check that" behavior, never invent results.
    """
    if not TAVILY_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                TAVILY_URL,
                json={
                    "api_key": TAVILY_API_KEY,
                    "query": query,
                    "max_results": max_results,
                    "include_answer": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": (r.get("content") or "")[:1000],
            }
            for r in data.get("results", [])
        ]
    except Exception as e:
        log.warning("tavily_search_failed", error=str(e)[:200])
        return []
