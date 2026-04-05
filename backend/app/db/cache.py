"""Redis-backed cache layer for read-heavy endpoints."""
import json
from typing import Any, Optional
from app.db.redis import get_redis
import structlog

log = structlog.get_logger()

DEFAULT_TTL = 300  # 5 minutes


async def cache_get(key: str) -> Optional[Any]:
    """Get a cached value. Returns None on miss or error."""
    try:
        redis = await get_redis()
        raw = await redis.get(f"cache:{key}")
        if raw:
            return json.loads(raw)
    except Exception as e:
        log.warning("cache_get_error", key=key, error=str(e))
    return None


async def cache_set(key: str, value: Any, ttl: int = DEFAULT_TTL):
    """Set a cached value with TTL in seconds."""
    try:
        redis = await get_redis()
        await redis.setex(f"cache:{key}", ttl, json.dumps(value, default=str))
    except Exception as e:
        log.warning("cache_set_error", key=key, error=str(e))


async def cache_invalidate(*keys: str):
    """Invalidate one or more cache keys."""
    try:
        redis = await get_redis()
        pipe = redis.pipeline()
        for key in keys:
            pipe.delete(f"cache:{key}")
        await pipe.execute()
    except Exception as e:
        log.warning("cache_invalidate_error", keys=keys, error=str(e))


async def cache_invalidate_pattern(pattern: str):
    """Invalidate all keys matching a pattern (e.g., 'projects:ws123:*')."""
    try:
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
