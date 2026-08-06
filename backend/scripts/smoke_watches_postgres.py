"""
Phase 6b smoke — Postgres path. Applies 016 if needed, creates a watch,
runs baseline + novelty cycles with mocked search (no Tavily required).
Does not print secrets.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path("/app") if Path("/app/app").is_dir() else Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT.parent / ".env", override=False)
load_dotenv(ROOT / ".env", override=False)

os.environ["DATABASE_BACKEND"] = "postgres"
os.environ.setdefault("CACHE_BACKEND", "redis")
os.environ["WATCH_CHECK_INTERVAL_S"] = "60"


async def main() -> None:
    if not os.getenv("DATABASE_URL"):
        print("SKIP_POSTGRES: DATABASE_URL not set")
        return

    from app.db.postgres import get_pool, close_pool
    from app.services import watch_service, watch_tool  # noqa: F401
    from app.services.agent_tools import TOOL_REGISTRY, ToolContext

    migration = (ROOT / "migrations" / "016_watches.sql").read_text(encoding="utf-8")
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(migration)
        print("migration_016_applied_or_exists")

        # Pick any real workspace/user if present; else skip create
        row = await conn.fetchrow(
            """
            SELECT u.id AS user_id, u.workspace_id
            FROM users u
            WHERE u.workspace_id IS NOT NULL AND u.deleted_at IS NULL
            LIMIT 1
            """
        )
    if row is None:
        print("SKIP_POSTGRES: no users in DB")
        await close_pool()
        return

    ws_id, user_id = str(row["workspace_id"]), str(row["user_id"])
    ctx = ToolContext(workspace_id=ws_id, user_id=user_id)
    topic = f"phase6b-smoke-{os.getpid()}"

    created = await TOOL_REGISTRY["create_watch"].execute({"query": topic}, ctx)
    print("create_watch", created.success, created.content.get("id") if created.content else None)
    assert created.success

    listed = await TOOL_REGISTRY["list_watches"].execute({}, ctx)
    ids = [w["id"] for w in listed.content["watches"]]
    assert created.content["id"] in ids
    print("list_watches_ok", "count=", listed.content["count"])

    async def fake_search(query: str, max_results: int = 5):
        if not hasattr(fake_search, "n"):
            fake_search.n = 0
        fake_search.n += 1
        if fake_search.n == 1:
            return [{"title": "Old Headline", "url": "https://ex/old", "content": "Old body"}]
        return [
            {"title": "New Headline Just In", "url": "https://ex/new", "content": "Brand new development"},
            {"title": "Old Headline", "url": "https://ex/old", "content": "Old body"},
        ]

    async def always_yes(topic, previous, current):
        return True

    watch_service.web_search.search = fake_search  # type: ignore
    watch_service.web_search.is_configured = lambda: True  # type: ignore
    watch_service._is_meaningfully_new = always_yes  # type: ignore

    # Only force-check this watch by temporarily cancelling others? force checks all.
    # Safer: call check_one_watch directly on ours.
    watch = (await watch_service.list_watches(ws_id, user_id))[0]
    # find our topic
    watch = next(w for w in await watch_service.list_watches(ws_id, user_id) if w["query"] == topic)

    r1 = await watch_service.check_one_watch(watch, force=True)
    print("cycle1", r1["status"])
    assert r1["status"] == "baseline"

    async with pool.acquire() as conn:
        before = await conn.fetchrow("SELECT pending_notice, last_seen_summary FROM watches WHERE id=$1", watch["id"])
    print("after_baseline pending=", before["pending_notice"] is not None, "summary_chars=", len(before["last_seen_summary"] or ""))

    watch2 = next(w for w in await watch_service.list_watches(ws_id, user_id) if w["query"] == topic)
    r2 = await watch_service.check_one_watch(watch2, force=True)
    print("cycle2", r2["status"], "notice=", r2.get("notice"))
    assert r2["status"] == "notice"

    notices = await watch_service.list_pending_notices(ws_id, user_id)
    ours = [n for n in notices if n["id"] == watch["id"]]
    assert ours
    print("notice_row", ours[0]["pending_notice"][:120])

    await watch_service.dismiss_notice(ws_id, user_id, watch["id"])
    await TOOL_REGISTRY["cancel_watch"].execute({"watch_id": watch["id"]}, ctx)
    print("POSTGRES_SMOKE_OK interval_default=", watch_service.DEFAULT_WATCH_INTERVAL_S)
    await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
