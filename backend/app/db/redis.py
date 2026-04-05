import redis.asyncio as redis
import os
from typing import Optional

_client: Optional[redis.Redis] = None

async def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379"),
            encoding="utf-8",
            decode_responses=True,
        )
    return _client

async def close_redis():
    global _client
    if _client:
        await _client.close()
        _client = None
