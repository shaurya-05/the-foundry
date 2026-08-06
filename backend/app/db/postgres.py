import asyncpg
import os
from typing import Optional

# DATABASE_BACKEND selects between the existing Postgres deployment
# (found3ry.com, unaffected -- this is the default, unchanged behavior)
# and the desktop build's local SQLite file (see app/db/sqlite.py).
# Every one of the ~37 call sites across routers/services does
# `pool = await get_pool()` then `async with pool.acquire() as conn:` --
# dispatching here means none of them need to know or care which backend
# is actually running.
_BACKEND = os.getenv("DATABASE_BACKEND", "postgres")

_pool: Optional[asyncpg.Pool] = None

async def get_pool():
    if _BACKEND == "sqlite":
        from app.db.sqlite import get_sqlite_pool
        return await get_sqlite_pool()

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
    if _BACKEND == "sqlite":
        from app.db.sqlite import close_sqlite_pool
        await close_sqlite_pool()
        return

    global _pool
    if _pool:
        await _pool.close()
        _pool = None
