import asyncpg
import os
from typing import Optional

_pool: Optional[asyncpg.Pool] = None

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=os.getenv("DATABASE_URL", "postgresql://foundry:foundry_secret@localhost:5432/foundry_db"),
            min_size=5,
            max_size=20,
            command_timeout=30,
            max_cached_statement_lifetime=300,
        )
    return _pool

async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
