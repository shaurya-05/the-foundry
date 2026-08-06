"""
Phase 6b — proactive watches.

User-created topics are checked on a conservative interval via Tavily
(web_search), then a CLASSIFIER-tier YES/NO judgment decides whether
anything is meaningfully new. New findings land in pending_notice only —
never spoken aloud, never modal.

Zero active watches ⇒ the periodic loop is a cheap no-op SELECT.
"""
from __future__ import annotations

import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import structlog

from app.db.postgres import get_pool
from app.services import web_search

log = structlog.get_logger()

# Conservative default: 30 minutes. Each active watch costs one Tavily
# call per interval; shorter intervals burn the free-tier quota quickly
# for little UX gain on a "check when you're back" notice surface.
DEFAULT_WATCH_INTERVAL_S = 1800


def watch_check_interval_s() -> int:
    raw = os.getenv("WATCH_CHECK_INTERVAL_S", str(DEFAULT_WATCH_INTERVAL_S))
    try:
        val = int(raw)
        return max(60, val)  # floor at 1 minute even for local testing
    except ValueError:
        return DEFAULT_WATCH_INTERVAL_S


def _row_to_watch(row: Any) -> dict:
    def _ts(v: Any) -> Optional[str]:
        if v is None:
            return None
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return str(v)

    return {
        "id": str(row["id"]),
        "workspace_id": str(row["workspace_id"]),
        "user_id": str(row["user_id"]),
        "query": row["query"],
        "created_at": _ts(row["created_at"]),
        "last_checked_at": _ts(row["last_checked_at"]),
        "last_seen_summary": row["last_seen_summary"],
        "pending_notice": row["pending_notice"],
        "notice_at": _ts(row["notice_at"]),
        "cancelled_at": _ts(row["cancelled_at"]),
    }


def _summarize_results(query: str, results: list[dict]) -> str:
    if not results:
        return f"No results for: {query}"
    lines = []
    for r in results[:5]:
        title = (r.get("title") or "").strip()
        content = (r.get("content") or "").strip().replace("\n", " ")
        url = (r.get("url") or "").strip()
        snippet = content[:280]
        lines.append(f"- {title}: {snippet} ({url})")
    return f"Topic: {query}\n" + "\n".join(lines)


def _fingerprint(summary: str) -> str:
    return hashlib.sha256(summary.strip().encode("utf-8")).hexdigest()


async def _is_meaningfully_new(topic: str, previous: str, current: str) -> bool:
    """Cheap novelty check: identical/hash match → no; else CLASSIFIER YES/NO."""
    if not previous or not previous.strip():
        return False
    if previous.strip() == current.strip():
        return False
    if _fingerprint(previous) == _fingerprint(current):
        return False

    # Title-set overlap heuristic — if every current title already appeared,
    # skip the model call.
    def _titles(summary: str) -> set[str]:
        out = set()
        for line in summary.splitlines():
            if line.startswith("- "):
                head = line[2:].split(":", 1)[0].strip().lower()
                if head:
                    out.add(head)
        return out

    prev_t, cur_t = _titles(previous), _titles(current)
    if cur_t and cur_t.issubset(prev_t):
        return False

    try:
        from app.services.model_provider import MODEL_REGISTRY

        provider = MODEL_REGISTRY["CLASSIFIER"]
        prompt = (
            "You decide if a watched topic has meaningfully NEW information a founder "
            "would want a quiet heads-up about.\n\n"
            f"Topic: {topic}\n\n"
            f"Previous summary:\n{previous[:1800]}\n\n"
            f"Current summary:\n{current[:1800]}\n\n"
            "Reply with exactly YES or NO — one word only. YES only if there is a real "
            "new development, not a rehash of the same headlines."
        )
        messages = [{"role": "user", "content": prompt}]
        parts: list[str] = []
        async for chunk in provider.complete(
            messages, stream=False, max_tokens=8, timeout_s=20.0
        ):
            if chunk.error:
                log.warning("watch_classifier_error", error=chunk.error)
                # Fail closed on classifier errors — don't spam notices.
                return False
            if chunk.content:
                parts.append(chunk.content)
        answer = "".join(parts).strip().upper()
        return answer.startswith("YES")
    except Exception as e:
        log.warning("watch_novelty_check_failed", error=str(e)[:200])
        return False


async def create_watch(workspace_id: str, user_id: str, query: str) -> dict:
    query = (query or "").strip()
    if not query:
        raise ValueError("query is required")
    if len(query) > 500:
        raise ValueError("query must be 500 characters or fewer")

    pool = await get_pool()
    async with pool.acquire() as conn:
        # Avoid near-duplicate active watches for the same user/topic.
        existing = await conn.fetchrow(
            """
            SELECT * FROM watches
            WHERE workspace_id=$1 AND user_id=$2 AND cancelled_at IS NULL
              AND lower(query)=lower($3)
            LIMIT 1
            """,
            workspace_id, user_id, query,
        )
        if existing:
            return _row_to_watch(existing)

        row = await conn.fetchrow(
            """
            INSERT INTO watches (workspace_id, user_id, query)
            VALUES ($1, $2, $3)
            RETURNING *
            """,
            workspace_id, user_id, query,
        )
    log.info("watch_created", workspace_id=workspace_id, query=query[:80])
    return _row_to_watch(row)


async def list_watches(workspace_id: str, user_id: str, include_cancelled: bool = False) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        if include_cancelled:
            rows = await conn.fetch(
                """
                SELECT * FROM watches
                WHERE workspace_id=$1 AND user_id=$2
                ORDER BY created_at DESC
                """,
                workspace_id, user_id,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT * FROM watches
                WHERE workspace_id=$1 AND user_id=$2 AND cancelled_at IS NULL
                ORDER BY created_at DESC
                """,
                workspace_id, user_id,
            )
    return [_row_to_watch(r) for r in rows]


async def cancel_watch(workspace_id: str, user_id: str, watch_id: str) -> Optional[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE watches
            SET cancelled_at=NOW(), pending_notice=NULL, notice_at=NULL
            WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND cancelled_at IS NULL
            RETURNING *
            """,
            watch_id, workspace_id, user_id,
        )
    if row is None:
        return None
    log.info("watch_cancelled", watch_id=watch_id)
    return _row_to_watch(row)


async def list_pending_notices(workspace_id: str, user_id: str) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM watches
            WHERE workspace_id=$1 AND user_id=$2
              AND cancelled_at IS NULL
              AND pending_notice IS NOT NULL
            ORDER BY notice_at DESC, created_at DESC
            """,
            workspace_id, user_id,
        )
    return [
        {
            "id": str(r["id"]),
            "query": r["query"],
            "pending_notice": r["pending_notice"],
            "notice_at": _row_to_watch(r)["notice_at"],
            "created_at": _row_to_watch(r)["created_at"],
        }
        for r in rows
    ]


async def dismiss_notice(workspace_id: str, user_id: str, watch_id: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE watches
            SET pending_notice=NULL, notice_at=NULL
            WHERE id=$1 AND workspace_id=$2 AND user_id=$3
              AND pending_notice IS NOT NULL
            RETURNING id
            """,
            watch_id, workspace_id, user_id,
        )
    return row is not None


async def check_one_watch(watch: dict, *, force: bool = False) -> dict:
    """
    Run a single watch check. Returns a status dict for tests/logging.
    First successful search establishes the baseline (no notice).
    """
    watch_id = watch["id"]
    query = watch["query"]
    previous = watch.get("last_seen_summary") or ""

    if not web_search.is_configured():
        log.info("watch_check_skipped", watch_id=watch_id, reason="tavily_unconfigured")
        return {"id": watch_id, "status": "skipped", "reason": "tavily_unconfigured"}

    results = await web_search.search(query, max_results=5)
    if not results:
        # Still bump last_checked_at so we don't hammer a dead query every tick.
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE watches SET last_checked_at=NOW() WHERE id=$1",
                watch_id,
            )
        return {"id": watch_id, "status": "no_results"}

    summary = _summarize_results(query, results)
    notice = None
    is_baseline = not previous.strip()

    if not is_baseline:
        if await _is_meaningfully_new(query, previous, summary):
            # Quiet notice — short, scannable; full summary stays in last_seen.
            tops = []
            for r in results[:3]:
                t = (r.get("title") or "").strip()
                if t:
                    tops.append(t)
            tops_line = "; ".join(tops) if tops else "new results"
            notice = f'Update on "{query}": {tops_line}'

    pool = await get_pool()
    async with pool.acquire() as conn:
        if notice:
            await conn.execute(
                """
                UPDATE watches
                SET last_checked_at=NOW(),
                    last_seen_summary=$2,
                    pending_notice=$3,
                    notice_at=NOW()
                WHERE id=$1
                """,
                watch_id, summary, notice,
            )
        else:
            await conn.execute(
                """
                UPDATE watches
                SET last_checked_at=NOW(),
                    last_seen_summary=$2
                WHERE id=$1
                """,
                watch_id, summary,
            )

    status = "baseline" if is_baseline else ("notice" if notice else "unchanged")
    log.info(
        "watch_checked",
        watch_id=watch_id,
        status=status,
        force=force,
        results=len(results),
    )
    return {
        "id": watch_id,
        "status": status,
        "notice": notice,
        "summary_preview": summary[:400],
    }


async def run_watch_check_cycle(*, force: bool = False) -> list[dict]:
    """
    Check every active watch that is due (or all of them when force=True).
    Safe to call with zero watches.
    """
    interval = watch_check_interval_s()
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=interval)
    pool = await get_pool()
    async with pool.acquire() as conn:
        if force:
            rows = await conn.fetch(
                "SELECT * FROM watches WHERE cancelled_at IS NULL ORDER BY created_at ASC"
            )
        else:
            rows = await conn.fetch(
                """
                SELECT * FROM watches
                WHERE cancelled_at IS NULL
                  AND (last_checked_at IS NULL OR last_checked_at < $1::timestamptz)
                ORDER BY CASE WHEN last_checked_at IS NULL THEN 0 ELSE 1 END,
                         last_checked_at ASC
                """,
                cutoff.isoformat(),
            )

    results = []
    for row in rows:
        watch = _row_to_watch(row)
        try:
            results.append(await check_one_watch(watch, force=force))
        except Exception as e:
            log.warning("watch_check_failed", watch_id=watch["id"], error=str(e)[:200])
            results.append({"id": watch["id"], "status": "error", "error": str(e)[:200]})
    if results:
        log.info("watch_cycle_complete", checked=len(results), interval_s=interval, force=force)
    return results


async def watch_loop(stop_event) -> None:
    """Background loop started from FastAPI lifespan."""
    import asyncio

    # Stagger first run slightly so boot isn't contended with tool registration.
    first_delay = min(30, watch_check_interval_s())
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=first_delay)
        return
    except asyncio.TimeoutError:
        pass

    while not stop_event.is_set():
        try:
            await run_watch_check_cycle(force=False)
        except Exception as e:
            log.warning("watch_loop_tick_failed", error=str(e)[:200])
        interval = watch_check_interval_s()
        # Wake at most every interval; stop_event ends the loop early on shutdown.
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
            return
        except asyncio.TimeoutError:
            continue