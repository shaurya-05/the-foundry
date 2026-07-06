
import httpx
import structlog
from app.db.postgres import get_pool
from app.services import circuit_breaker

log = structlog.get_logger()
NOTION_VERSION = "2022-06-28"

async def run_initial_notion_sync(workspace_id: str, user_id: str, access_token: str):
    if await circuit_breaker.is_open("notion"):
        log.info("notion_sync_short_circuited", workspace_id=workspace_id)
        return {"status": "skipped", "reason": "notion circuit breaker open"}

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }
    pages = []
    cursor = None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                body = {"filter": {"value": "page", "property": "object"}, "page_size": 100}
                if cursor:
                    body["start_cursor"] = cursor
                resp = await client.post("https://api.notion.com/v1/search", headers=headers, json=body)
                if resp.status_code != 200:
                    log.error("notion_search_failed", status=resp.status_code)
                    await circuit_breaker.record_failure(
                        "notion", reason=f"search HTTP {resp.status_code}",
                    )
                    break
                data = resp.json()
                pages.extend(data.get("results", []))
                if not data.get("has_more"):
                    break
                cursor = data.get("next_cursor")

        log.info("notion_pages_fetched", count=len(pages), workspace_id=workspace_id)
        pool = await get_pool()
        async with pool.acquire() as conn:
            for page in pages:
                page_id = page.get("id", "")
                props = page.get("properties", {})
                title = "Untitled"
                for prop in props.values():
                    if prop.get("type") == "title":
                        parts = prop.get("title", [])
                        if parts:
                            title = "".join(p.get("plain_text", "") for p in parts)
                            break
                url = page.get("url", "")
                await conn.execute(
                    """
                    INSERT INTO knowledge (workspace_id, user_id, title, content, type, source, source_url, source_id)
                    VALUES ($1, $2, $3, $4, 'notion_page', 'notion', $5, $6)
                    ON CONFLICT (workspace_id, source, source_id) DO UPDATE
                      SET title = EXCLUDED.title, updated_at = NOW()
                    """,
                    workspace_id, user_id, title, f"Notion page: {title}", url, page_id,
                )
        log.info("notion_sync_complete", pages=len(pages), workspace_id=workspace_id)
        await circuit_breaker.record_success("notion")
        return {"status": "ok", "pages": len(pages)}
    except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as e:
        await circuit_breaker.record_failure("notion", reason=type(e).__name__)
        log.error("notion_sync_failed", error=str(e), workspace_id=workspace_id)
        return {"status": "error", "reason": type(e).__name__}
    except Exception as e:
        await circuit_breaker.record_failure("notion", reason=f"{type(e).__name__}: {str(e)[:100]}")
        log.error("notion_sync_failed", error=str(e), workspace_id=workspace_id)
        return {"status": "error", "reason": str(e)[:100]}
