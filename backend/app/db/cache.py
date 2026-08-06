"""Cache layer for read-heavy endpoints.

Default backend is Redis (found3ry.com / docker-compose.local-prod —
unchanged). Desktop sets CACHE_BACKEND=memory for a process-local TTL
dict so no Redis server is required.
"""
from __future__ import annotations

import fnmatch
import json
import os
import time
from typing import Any, Optional

import structlog

log = structlog.get_logger()

DEFAULT_TTL = 300  # 5 minutes
_BACKEND = os.getenv("CACHE_BACKEND", "redis").lower()

# In-memory store: key -> (expires_at_epoch_or_None, value)
# Keys are stored WITHOUT the "cache:" prefix (same logical key the
# callers pass). Redis path still prefixes with "cache:" for wire format.
_memory: dict[str, tuple[Optional[float], Any]] = {}


def _use_memory() -> bool:
    return _BACKEND in ("memory", "mem", "local", "inprocess")


def _memory_get(key: str) -> Optional[Any]:
    item = _memory.get(key)
    if item is None:
        return None
    expires_at, value = item
    if expires_at is not None and time.time() >= expires_at:
        _memory.pop(key, None)
        return None
    return value


def _memory_set(key: str, value: Any, ttl: int) -> None:
    expires_at = (time.time() + ttl) if ttl and ttl > 0 else None
    # Round-trip through JSON so memory backend matches Redis's
    # serialize-then-deserialize behavior (dates → strings, etc.).
    _memory[key] = (expires_at, json.loads(json.dumps(value, default=str)))


def _memory_invalidate(*keys: str) -> None:
    for key in keys:
        _memory.pop(key, None)


def _memory_invalidate_pattern(pattern: str) -> None:
    # Callers pass patterns like 'tasks_list:{ws}:*' — same shape the
    # Redis path matches against 'cache:{pattern}'.
    to_delete = [k for k in list(_memory.keys()) if fnmatch.fnmatch(k, pattern)]
    for key in to_delete:
        _memory.pop(key, None)


async def cache_get(key: str) -> Optional[Any]:
    """Get a cached value. Returns None on miss or error."""
    if _use_memory():
        try:
            return _memory_get(key)
        except Exception as e:
            log.warning("cache_get_error", key=key, error=str(e), backend="memory")
            return None
    try:
        from app.db.redis import get_redis
        redis = await get_redis()
        raw = await redis.get(f"cache:{key}")
        if raw:
            return json.loads(raw)
    except Exception as e:
        log.warning("cache_get_error", key=key, error=str(e))
    return None


async def cache_set(key: str, value: Any, ttl: int = DEFAULT_TTL):
    """Set a cached value with TTL in seconds."""
    if _use_memory():
        try:
            _memory_set(key, value, ttl)
        except Exception as e:
            log.warning("cache_set_error", key=key, error=str(e), backend="memory")
        return
    try:
        from app.db.redis import get_redis
        redis = await get_redis()
        await redis.setex(f"cache:{key}", ttl, json.dumps(value, default=str))
    except Exception as e:
        log.warning("cache_set_error", key=key, error=str(e))


async def cache_invalidate(*keys: str):
    """Invalidate one or more cache keys."""
    if _use_memory():
        try:
            _memory_invalidate(*keys)
        except Exception as e:
            log.warning("cache_invalidate_error", keys=keys, error=str(e), backend="memory")
        return
    try:
        from app.db.redis import get_redis
        redis = await get_redis()
        pipe = redis.pipeline()
        for key in keys:
            pipe.delete(f"cache:{key}")
        await pipe.execute()
    except Exception as e:
        log.warning("cache_invalidate_error", keys=keys, error=str(e))


async def cache_invalidate_pattern(pattern: str):
    """Invalidate all keys matching a pattern (e.g., 'projects:ws123:*')."""
    if _use_memory():
        try:
            _memory_invalidate_pattern(pattern)
        except Exception as e:
            log.warning(
                "cache_invalidate_pattern_error",
                pattern=pattern, error=str(e), backend="memory",
            )
        return
    try:
        from app.db.redis import get_redis
        redis = await get_redis()
        cursor = 0
        while True:
            cursor, keys = await redis.scan(cursor, match=f"cache:{pattern}", count=100)
            if keys:
                await redis.delete(*keys)
            if cursor == 0:
                break
    except Exception as e:
        log.warning("cache_invalidate_pattern_error", pattern=pattern, error=str(e))
