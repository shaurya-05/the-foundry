"""
Phase 6b smoke test — SQLite path (desktop default).
Creates a watch, runs two check cycles (baseline + novelty), prints rows.
Uses a temp SQLite DB; mocks Tavily + classifier when keys are missing.
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ["DATABASE_BACKEND"] = "sqlite"
os.environ["CACHE_BACKEND"] = "memory"
os.environ["GRAPH_BACKEND"] = "none"
os.environ["CELERY_ENABLED"] = "0"
os.environ["WATCH_CHECK_INTERVAL_S"] = "60"

# Unique temp DB so we don't touch the user's desktop data
_db = tempfile.NamedTemporaryFile(suffix="_watches.db", delete=False)
_db.close()
os.environ["SQLITE_DB_PATH"] = _db.name


async def main() -> None:
    from app.db.postgres import get_pool, close_pool
    from app.db import sqlite as sqlite_mod
    from app.services import watch_service, watch_tool  # noqa: F401 — register tools
    from app.services.agent_tools import TOOL_REGISTRY, ToolContext

    # Ensure tools registered
    assert "create_watch" in TOOL_REGISTRY
    assert "list_watches" in TOOL_REGISTRY
    assert "cancel_watch" in TOOL_REGISTRY
    print("tools_ok", sorted(k for k in TOOL_REGISTRY if "watch" in k))

    pool = await get_pool()

    async with pool.acquire() as conn:
        # Bootstrap: workspace requires owner_id; user requires workspace_id.
        # Insert workspace with a temp owner, then user, then fix owner_id.
        ws = await conn.fetchrow(
            "INSERT INTO workspaces (name, owner_id) VALUES ($1, $2) RETURNING id",
            "watch-smoke", "00000000-0000-0000-0000-000000000001",
        )
        ws_id = str(ws["id"])
        user = await conn.fetchrow(
            """
            INSERT INTO users (workspace_id, email, password_hash, display_name)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            """,
            ws_id, "watch-smoke@example.com", "x", "Watch Smoke",
        )
        user_id = str(user["id"])
        await conn.execute(
            "UPDATE workspaces SET owner_id=$1 WHERE id=$2",
            user_id, ws_id,
        )

    ctx = ToolContext(workspace_id=ws_id, user_id=user_id)

    created = await TOOL_REGISTRY["create_watch"].execute(
        {"query": "OpenAI GPT-5 release news"}, ctx
    )
    print("create_watch", created.success, created.content)
    assert created.success

    listed = await TOOL_REGISTRY["list_watches"].execute({}, ctx)
    print("list_watches", listed.content)
    assert listed.content["count"] == 1

    # Mock Tavily + classifier for deterministic novelty without API keys
    async def fake_search(query: str, max_results: int = 5):
        # First call vs second call differ via mutable flag
        if not hasattr(fake_search, "n"):
            fake_search.n = 0
        fake_search.n += 1
        if fake_search.n == 1:
            return [
                {"title": "Same Story A", "url": "https://ex/a", "content": "Baseline content about the topic."},
                {"title": "Same Story B", "url": "https://ex/b", "content": "More baseline."},
            ]
        return [
            {"title": "Breaking: Brand New Development", "url": "https://ex/new", "content": "Something meaningfully new happened today."},
            {"title": "Same Story A", "url": "https://ex/a", "content": "Baseline content about the topic."},
        ]

    async def always_yes(topic, previous, current):
        return True

    watch_service.web_search.search = fake_search  # type: ignore
    watch_service.web_search.is_configured = lambda: True  # type: ignore
    watch_service._is_meaningfully_new = always_yes  # type: ignore

    r1 = await watch_service.run_watch_check_cycle(force=True)
    print("cycle1", r1)
    assert r1[0]["status"] == "baseline"

    async with pool.acquire() as conn:
        row_after_1 = await conn.fetchrow("SELECT * FROM watches WHERE workspace_id=$1", ws_id)
    print("row_after_baseline pending_notice=", row_after_1["pending_notice"])
    print("row_after_baseline summary_len=", len(row_after_1["last_seen_summary"] or ""))
    assert row_after_1["pending_notice"] is None
    assert row_after_1["last_seen_summary"]

    r2 = await watch_service.run_watch_check_cycle(force=True)
    print("cycle2", r2)
    assert r2[0]["status"] == "notice"

    async with pool.acquire() as conn:
        row_after_2 = await conn.fetchrow("SELECT * FROM watches WHERE workspace_id=$1", ws_id)
    print("row_after_notice pending_notice=", row_after_2["pending_notice"])
    assert row_after_2["pending_notice"]

    notices = await watch_service.list_pending_notices(ws_id, user_id)
    print("notices", notices)
    assert len(notices) == 1

    ok = await watch_service.dismiss_notice(ws_id, user_id, notices[0]["id"])
    assert ok
    notices2 = await watch_service.list_pending_notices(ws_id, user_id)
    assert notices2 == []
    print("dismissed_ok")

    cancelled = await TOOL_REGISTRY["cancel_watch"].execute(
        {"query": "OpenAI GPT-5 release news"}, ctx
    )
    print("cancel", cancelled.content)
    assert cancelled.success

    await close_pool()
    # reset module pool for cleanliness
    sqlite_mod._pool = None
    print("SQLITE_SMOKE_OK", "db=", _db.name)
    print("DEFAULT_INTERVAL_S", watch_service.DEFAULT_WATCH_INTERVAL_S)


if __name__ == "__main__":
    asyncio.run(main())
