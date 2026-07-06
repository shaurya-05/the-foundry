"""
Google Drive service — create, read, and sync Docs from FOUND3RY.
"""
import httpx
import structlog
from app.db.postgres import get_pool
from app.services import circuit_breaker
from app.services.oauth_encryption import decrypt_token

log = structlog.get_logger()

DRIVE_API = "https://www.googleapis.com/drive/v3"
DOCS_API = "https://docs.googleapis.com/v1"

async def _get_token(workspace_id: str, user_id: str) -> str | None:
    """Get decrypted Google OAuth token for a user."""
    from app.services import graph_repo
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await graph_repo.get_oauth_connection(conn, user_id, "google")
    if not row:
        return None
    try:
        return decrypt_token(row["access_token_encrypted"])
    except Exception:
        return None

async def create_doc(workspace_id: str, user_id: str, title: str, content: str) -> dict:
    """Create a Google Doc and return its URL and ID."""
    # Circuit breaker: skip the call entirely if Drive has been failing.
    if await circuit_breaker.is_open("google_drive"):
        raise ValueError("Google Drive is temporarily unavailable. Try again in a couple minutes.")

    token = await _get_token(workspace_id, user_id)
    if not token:
        raise ValueError("No Google connection found. Connect Google Drive in Settings.")

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Create the doc
            res = await client.post(
                f"{DOCS_API}/documents",
                headers=headers,
                json={"title": title},
            )
            if res.status_code != 200:
                await circuit_breaker.record_failure(
                    "google_drive", reason=f"create HTTP {res.status_code}",
                )
                raise ValueError(f"Failed to create doc: {res.status_code}")

            doc = res.json()
            doc_id = doc["documentId"]

            # Insert content
            await client.post(
                f"{DOCS_API}/documents/{doc_id}:batchUpdate",
                headers=headers,
                json={
                    "requests": [{
                        "insertText": {
                            "location": {"index": 1},
                            "text": content,
                        }
                    }]
                },
            )
    except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as e:
        await circuit_breaker.record_failure("google_drive", reason=type(e).__name__)
        raise ValueError(f"Google Drive is unreachable right now ({type(e).__name__}). Try again.")

    await circuit_breaker.record_success("google_drive")
    url = f"https://docs.google.com/document/d/{doc_id}/edit"
    log.info("gdoc_created", doc_id=doc_id, workspace_id=workspace_id)
    return {"doc_id": doc_id, "url": url, "title": title}

async def list_drive_files(workspace_id: str, user_id: str, max_results: int = 20) -> list:
    """List recent Google Drive files."""
    token = await _get_token(workspace_id, user_id)
    if not token:
        return []

    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(
            f"{DRIVE_API}/files",
            headers=headers,
            params={
                "pageSize": max_results,
                "fields": "files(id,name,mimeType,modifiedTime,webViewLink)",
                "orderBy": "modifiedTime desc",
                "q": "trashed=false",
            },
        )
        if res.status_code != 200:
            return []
        return res.json().get("files", [])
