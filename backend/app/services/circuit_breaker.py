"""
Connector circuit breaker.

For external connectors (Notion, Google Drive, GitHub, etc.), track a
recent failure count in Redis. Once N failures accumulate inside an M-
minute rolling window, further calls short-circuit with a clean
"connector not available" signal instead of hitting the connector and
timing out again — that's what protects the SSE stream from stalling
when Notion is having a bad day.

Design:
    - Redis keys `cb:{connector}:fail_ts` are sorted sets keyed by
      failure timestamp, so we can compute "failures in the last M
      minutes" with ZCOUNT and prune with ZREMRANGEBYSCORE.
    - `record_success` clears the failure history and any tripped state.
    - `record_failure` adds a timestamp; if the count exceeds
      TRIP_THRESHOLD, the breaker enters "open" state (via a separate
      key with TTL = OPEN_COOLDOWN_S). While open, `is_open` returns
      True and callers should skip.
    - After OPEN_COOLDOWN_S elapses, the breaker is half-open — one
      call is permitted; success clears everything, failure re-opens.

Everything degrades gracefully if Redis is unreachable — is_open returns
False so we don't false-positive close a connector.
"""
from __future__ import annotations

import os
import time
from typing import Optional

import structlog

from app.db.redis import get_redis

log = structlog.get_logger()

# Tuning knobs — env-overridable for ops without a code change.
WINDOW_S = int(os.getenv("CB_WINDOW_S", "300"))           # 5 min rolling window
TRIP_THRESHOLD = int(os.getenv("CB_TRIP_THRESHOLD", "5")) # 5 failures in the window trips
OPEN_COOLDOWN_S = int(os.getenv("CB_OPEN_COOLDOWN_S", "120"))  # 2 min cooldown before half-open

# Known connectors. New ones just need to add themselves here to appear
# in the admin dashboard health snapshot.
CONNECTORS = ("github", "notion", "google_drive", "voyage", "anthropic", "openai", "perplexity", "gemini")


def _fail_key(connector: str) -> str:
    return f"cb:{connector}:fail_ts"


def _open_key(connector: str) -> str:
    return f"cb:{connector}:open"


async def is_open(connector: str) -> bool:
    """True if the breaker is tripped and calls should short-circuit."""
    try:
        r = await get_redis()
        return bool(await r.get(_open_key(connector)))
    except Exception:
        # Fail-safe: if Redis is down, treat every breaker as closed so
        # we don't accidentally lock everyone out.
        return False


async def record_success(connector: str) -> None:
    """Clear failure history + any tripped state on a successful call."""
    try:
        r = await get_redis()
        await r.delete(_fail_key(connector), _open_key(connector))
    except Exception:
        pass


async def record_failure(connector: str, *, reason: Optional[str] = None) -> bool:
    """
    Record a failure. Returns True if this failure tripped the breaker.
    """
    try:
        r = await get_redis()
        now = time.time()
        key = _fail_key(connector)
        # ZADD score=timestamp, member=timestamp (unique per second is fine
        # given the threshold — collisions just count as one failure)
        await r.zadd(key, {str(now): now})
        # Prune failures outside the rolling window
        await r.zremrangebyscore(key, 0, now - WINDOW_S)
        await r.expire(key, WINDOW_S * 2)  # let old data die if no traffic
        recent = await r.zcount(key, now - WINDOW_S, now)
        if recent >= TRIP_THRESHOLD:
            await r.setex(_open_key(connector), OPEN_COOLDOWN_S, "1")
            log.warning(
                "circuit_breaker_tripped",
                connector=connector, recent_failures=recent,
                reason=(reason or "unspecified")[:120],
                cooldown_s=OPEN_COOLDOWN_S,
            )
            return True
        return False
    except Exception as e:
        log.warning("circuit_breaker_record_failed", connector=connector, error=str(e)[:120])
        return False


async def status(connector: str) -> dict:
    """Snapshot of one connector's breaker state — for admin dashboard."""
    try:
        r = await get_redis()
        now = time.time()
        key = _fail_key(connector)
        recent = await r.zcount(key, now - WINDOW_S, now)
        open_ttl = await r.ttl(_open_key(connector))  # -2 if missing, -1 if no ttl, positive if open
        state = "open" if open_ttl and open_ttl > 0 else "closed"
        return {
            "connector": connector,
            "state": state,
            "recent_failures": int(recent or 0),
            "window_s": WINDOW_S,
            "trip_threshold": TRIP_THRESHOLD,
            "cooldown_remaining_s": max(0, open_ttl) if open_ttl and open_ttl > 0 else 0,
        }
    except Exception as e:
        return {"connector": connector, "state": "unknown", "error": str(e)[:120]}


async def all_status() -> list[dict]:
    """Snapshot of every registered connector — for admin health endpoint."""
    return [await status(c) for c in CONNECTORS]


# ─── Guard decorator ────────────────────────────────────────────────────────
# Convenience: wrap an async connector call so it auto-records success or
# failure and short-circuits when the breaker is open.
#
#     @with_breaker("notion")
#     async def sync_notion_page(...): ...
#
# The wrapped function raises BreakerOpen when the breaker is open;
# callers should catch and return a "not connected right now" message.


class BreakerOpen(RuntimeError):
    def __init__(self, connector: str):
        super().__init__(f"{connector} circuit breaker is open")
        self.connector = connector


def with_breaker(connector: str):
    """Decorator: auto-record success/failure + short-circuit when open."""
    def _wrap(fn):
        async def _inner(*args, **kwargs):
            if await is_open(connector):
                log.info("circuit_breaker_short_circuit", connector=connector)
                raise BreakerOpen(connector)
            try:
                result = await fn(*args, **kwargs)
            except Exception as e:
                await record_failure(connector, reason=f"{type(e).__name__}: {e}")
                raise
            await record_success(connector)
            return result
        _inner.__name__ = fn.__name__
        return _inner
    return _wrap
