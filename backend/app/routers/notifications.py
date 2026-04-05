from fastapi import APIRouter, Depends, HTTPException
from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

@router.get("")
async def list_notifications(auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT * FROM notifications
               WHERE user_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT 50""",
            auth.user_id, auth.workspace_id
        )
        return [_row_to_notif(r) for r in rows]

@router.patch("/{notif_id}/read")
async def mark_read(notif_id: str, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2",
            notif_id, auth.user_id
        )
        if result == "UPDATE 0":
            raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@router.patch("/read-all")
async def mark_all_read(auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE notifications SET read=true WHERE user_id=$1",
            auth.user_id
        )
    return {"ok": True}

@router.delete("/{notif_id}")
async def delete_notification(notif_id: str, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM notifications WHERE id=$1 AND user_id=$2",
            notif_id, auth.user_id
        )
    return {"ok": True}

def _row_to_notif(row):
    return {
        "id": str(row["id"]),
        "type": row["type"],
        "title": row["title"],
        "body": row["body"],
        "read": row["read"],
        "created_at": row["created_at"].isoformat(),
    }
