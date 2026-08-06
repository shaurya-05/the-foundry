"""
Watch notices API — Phase 6b quiet surfacing.

GET pending notices for the signed-in user; dismiss clears pending_notice
without cancelling the watch. POST /run-check forces a check cycle (useful
for verification; still quiet — never speaks).
"""
from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import AuthContext, require_auth
from app.services import watch_service

router = APIRouter(prefix="/api/watches", tags=["watches"])


@router.get("")
async def list_watches(auth: AuthContext = Depends(require_auth)):
    return await watch_service.list_watches(auth.workspace_id, auth.user_id)


@router.get("/notices")
async def list_notices(auth: AuthContext = Depends(require_auth)):
    return await watch_service.list_pending_notices(auth.workspace_id, auth.user_id)


@router.post("/notices/{watch_id}/dismiss")
async def dismiss_notice(watch_id: str, auth: AuthContext = Depends(require_auth)):
    ok = await watch_service.dismiss_notice(auth.workspace_id, auth.user_id, watch_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notice not found")
    return {"ok": True}


@router.post("/run-check")
async def run_check(auth: AuthContext = Depends(require_auth), force: bool = True):
    """
    Manually trigger a watch check cycle for verification / impatient users.
    Scoped globally to due watches (or all when force=true); results are still
    quiet pending_notice rows — no speech, no push modal.
    """
    # force=true checks every active watch regardless of last_checked_at.
    results = await watch_service.run_watch_check_cycle(force=force)
    # Only return this user's watches' outcomes for privacy.
    mine = await watch_service.list_watches(auth.workspace_id, auth.user_id)
    mine_ids = {w["id"] for w in mine}
    return {
        "checked": [r for r in results if r.get("id") in mine_ids],
        "interval_s": watch_service.watch_check_interval_s(),
    }
