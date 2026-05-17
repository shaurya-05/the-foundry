"""
Webhook receivers for third-party connectors.

Phase 2 §4.1.2 — GitHub posts to /api/webhooks/github.

Security model:
    - HMAC-SHA256 over the raw request body, signed with
      GITHUB_WEBHOOK_SECRET (configure as the "Secret" field on the
      GitHub webhook). Constant-time compare via hmac.compare_digest.
    - Replay protection: webhook_events (provider, delivery_id) is
      UNIQUE; duplicate deliveries land in the ledger but skip
      processing.

Workspace resolution:
    The payload identifies the repo; we look up ventures rows where
    metadata.github_repo matches, then trust workspace_id from the
    venture. If no venture is registered for the repo, we drop the
    event (a workspace has to have done initial-sync at least once
    for the repo to be on the graph).
"""
from __future__ import annotations

import json
import os
from typing import Optional

import structlog
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from app.db.postgres import get_pool
from app.services.github_webhook import process_event, verify_signature

log = structlog.get_logger()

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


@router.post("/github")
async def github_webhook(
    request: Request,
    background: BackgroundTasks,
    x_github_event: Optional[str] = Header(None),
    x_github_delivery: Optional[str] = Header(None),
    x_hub_signature_256: Optional[str] = Header(None),
):
    body = await request.body()
    secret = os.getenv("GITHUB_WEBHOOK_SECRET", "")
    if not secret:
        log.error("github_webhook_secret_unset")
        raise HTTPException(status_code=503, detail="Webhook secret not configured")
    if not verify_signature(secret, body, x_hub_signature_256):
        log.warning("github_webhook_bad_signature", delivery=x_github_delivery)
        raise HTTPException(status_code=401, detail="Invalid signature")
    if not x_github_event or not x_github_delivery:
        raise HTTPException(status_code=400, detail="Missing GitHub event headers")

    # Drop GitHub pings cheaply.
    if x_github_event == "ping":
        return {"status": "pong"}

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    repo = payload.get("repository") or {}
    full_name = repo.get("full_name")
    if not full_name:
        log.info("github_webhook_no_repo", event=x_github_event)
        return {"status": "ignored", "reason": "no repository"}

    # Resolve workspace via venture metadata
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT workspace_id FROM ventures
            WHERE metadata->>'github_repo' = $1 AND deleted_at IS NULL
            """,
            full_name,
        )
    if not rows:
        log.info("github_webhook_no_workspace", repo=full_name, event=x_github_event)
        return {"status": "ignored", "reason": "no workspace tracks this repo"}

    # A repo can be tracked by multiple workspaces (e.g. solo + team).
    # Process for each in the background so the response stays fast.
    for r in rows:
        background.add_task(
            process_event,
            workspace_id=str(r["workspace_id"]),
            delivery_id=x_github_delivery,
            event_type=x_github_event,
            payload=payload,
        )

    return JSONResponse({"status": "accepted", "workspaces": len(rows)})
