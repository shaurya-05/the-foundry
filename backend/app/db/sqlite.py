"""
SQLite backend for the desktop build (DATABASE_BACKEND=sqlite) -- an
asyncpg-shaped wrapper over aiosqlite, so the ~37 existing call sites
across routers/services (all written as `pool = await get_pool()`, then
`async with pool.acquire() as conn: await conn.fetch(...)`) don't need to
change at all. Only app/db/postgres.py's get_pool() dispatches here based
on DATABASE_BACKEND; everything downstream of that call is untouched.

The existing Postgres/Docker deployment (found3ry.com) is completely
unaffected by this module -- it's additive, not a replacement. See
backend/migrations/sqlite/schema.sql for the consolidated schema this
applies (translated from the real live Postgres schema, not hand-traced
through the 18 incremental Postgres migrations).

Concurrency model: this is a single-user desktop app, not a multi-tenant
server -- one shared aiosqlite connection guarded by an asyncio.Lock is
simpler and safer than trying to run a real multi-connection pool against
a single SQLite file (which just fights itself over the one write lock
SQLite has anyway). `pool.acquire()` still yields a connection-shaped
object so calling code is unaware of the difference.

Query translation: asyncpg queries in this codebase use Postgres-native
`$1, $2, ...` positional placeholders and occasional `::type` casts
(`$2::vector`, `::jsonb`). SQLite's DB-API uses positional `?` -- since
every $N in this codebase appears once, in ascending order, straight
left-to-right substitution is correct (verified against real query
patterns during Phase 2 testing, not assumed). `::type` casts are
stripped since SQLite is dynamically typed and doesn't need them.
"""
import asyncio
import os
import re
import secrets
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import aiosqlite
import structlog

log = structlog.get_logger()

_PLACEHOLDER_RE = re.compile(r"\$(\d+)")
_CAST_RE = re.compile(r"::[a-zA-Z_][a-zA-Z0-9_\[\]]*")

_SCHEMA_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "migrations", "sqlite", "schema.sql"
)


def _translate_query(query: str, args: tuple) -> tuple[str, tuple]:
    """
    $1, $2, ... -> ? (positional); strip ::type casts. Also expands args
    to match -- asyncpg allows the same $N to appear more than once in a
    query bound to a single value (seen for real in
    copilot.py's cross-thread digest: `$3::uuid IS NULL OR thread_id <>
    $3::uuid`), but SQLite's ? is purely positional and needs one bound
    value per occurrence, not per unique N. Naive $N->? substitution
    with the original args tuple passed through unchanged breaks (and
    did, in real testing) the moment any $N repeats -- this rebuilds the
    args list to have one entry per placeholder OCCURRENCE, pulled from
    args[N-1] each time, so repeated $N are handled correctly rather
    than assumed not to happen.
    """
    query = _CAST_RE.sub("", query)
    expanded_args = []

    def _replace(m: "re.Match") -> str:
        n = int(m.group(1))
        expanded_args.append(args[n - 1])
        return "?"

    translated = _PLACEHOLDER_RE.sub(_replace, query)
    return translated, tuple(expanded_args)


def _maybe_parse_datetime(value: Any) -> Any:
    """
    asyncpg auto-converts `timestamp with time zone` columns to real
    Python datetime objects -- calling code across this codebase relies
    on that (e.g. usage.py calling .date() on a fetched created_at).
    SQLite has no native datetime type, so every timestamp column is
    just TEXT here; without this, every one of those call sites would
    break with AttributeError, one at a time, as each gets exercised.

    Rather than hardcode which of the ~20 differently-named timestamp
    columns across 35 tables to convert, this tries datetime.fromisoformat()
    on every string value and keeps the parsed datetime if it succeeds.
    Python 3.11+'s fromisoformat is permissive enough to accept both
    SQLite's own datetime('now') format (space-separated, no timezone)
    and this module's registered now()/gen_random_uuid-adjacent ISO
    strings. A non-datetime string (chat content, titles, etc.) doesn't
    match the strict format and is returned unchanged -- the failure
    mode of a false-positive match here (a stray datetime where a plain
    string was expected) is far less severe than the guaranteed crash
    this fixes.
    """
    if not isinstance(value, str):
        return value
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return value


def _row_to_dict(row: Optional[sqlite3.Row]) -> Optional[dict]:
    if row is None:
        return None
    return {k: _maybe_parse_datetime(v) for k, v in dict(row).items()}


class SQLiteConnWrapper:
    """Mimics the slice of asyncpg.Connection this codebase actually calls:
    fetch, fetchrow, fetchval, execute. Not a general-purpose asyncpg
    shim -- just enough surface for the real call sites."""

    def __init__(self, conn: aiosqlite.Connection, lock: asyncio.Lock):
        self._conn = conn
        self._lock = lock

    async def fetch(self, query: str, *args: Any) -> list[dict]:
        sql, bound = _translate_query(query, args)
        async with self._lock:
            cursor = await self._conn.execute(sql, bound)
            rows = await cursor.fetchall()
            await self._conn.commit()
            return [_row_to_dict(r) for r in rows]

    async def fetchrow(self, query: str, *args: Any) -> Optional[dict]:
        sql, bound = _translate_query(query, args)
        async with self._lock:
            cursor = await self._conn.execute(sql, bound)
            row = await cursor.fetchone()
            await self._conn.commit()
            return _row_to_dict(row)

    async def fetchval(self, query: str, *args: Any) -> Any:
        row = await self.fetchrow(query, *args)
        if row is None:
            return None
        return next(iter(row.values()))

    async def execute(self, query: str, *args: Any) -> str:
        sql, bound = _translate_query(query, args)
        async with self._lock:
            cursor = await self._conn.execute(sql, bound)
            await self._conn.commit()
            return f"OK {cursor.rowcount}"

    async def executemany(self, query: str, args_list: list[tuple]) -> None:
        if not args_list:
            return
        sql, _ = _translate_query(query, args_list[0])
        expanded = [_translate_query(query, a)[1] for a in args_list]
        async with self._lock:
            await self._conn.executemany(sql, expanded)
            await self._conn.commit()


class _AcquireCtx:
    def __init__(self, pool: "SQLitePoolWrapper"):
        self._pool = pool

    async def __aenter__(self) -> SQLiteConnWrapper:
        return SQLiteConnWrapper(self._pool._conn, self._pool._lock)

    async def __aexit__(self, *exc):
        return False


class SQLitePoolWrapper:
    """Stands in for asyncpg.Pool. acquire() is the only method the
    codebase actually uses on a pool object."""

    def __init__(self, conn: aiosqlite.Connection):
        self._conn = conn
        self._lock = asyncio.Lock()

    def acquire(self) -> _AcquireCtx:
        return _AcquireCtx(self)

    async def close(self):
        await self._conn.close()


_pool: Optional[SQLitePoolWrapper] = None


async def _register_functions(conn: aiosqlite.Connection) -> None:
    # Postgres's gen_random_uuid()/gen_random_bytes() have no SQLite
    # equivalent -- registered here so DEFAULT (gen_random_uuid()) and
    # DEFAULT (gen_random_hex_token(32)) in schema.sql work unchanged at
    # insert time, and so any explicit call in query text also works.
    # aiosqlite's create_function is a coroutine, unlike the underlying
    # sqlite3 module's synchronous one -- caught by actually running this,
    # not assumed from the sqlite3 stdlib docs.
    await conn.create_function("gen_random_uuid", 0, lambda: str(uuid.uuid4()))
    await conn.create_function("gen_random_hex_token", 1, lambda n: secrets.token_hex(n))
    # Postgres's NOW() appears as a literal inline call throughout the
    # codebase's query text (not just at insert time via a column
    # DEFAULT), e.g. "VALUES ($1, $2, NOW())" -- SQLite has no built-in
    # NOW, so it's registered as a function rather than trying to regex-
    # translate every occurrence, the same reasoning as gen_random_uuid()
    # above. SQLite function name lookup is case-insensitive, so this
    # covers NOW()/now() both.
    await conn.create_function("now", 0, lambda: datetime.now(timezone.utc).isoformat())
    # Covers the real units this codebase actually calls date_trunc with
    # (usage.py: 'month', analytics.py: 'week') -- not a general
    # reimplementation of Postgres's date_trunc for every possible unit.
    await conn.create_function("date_trunc", 2, _date_trunc)


def _date_trunc(unit: str, value: str) -> str:
    dt = datetime.fromisoformat(value)
    if unit == "month":
        return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0).date().isoformat()
    if unit == "week":
        monday = dt - timedelta(days=dt.weekday())
        return monday.replace(hour=0, minute=0, second=0, microsecond=0).date().isoformat()
    if unit == "year":
        return dt.replace(month=1, day=1).date().isoformat()
    return dt.date().isoformat()


async def _ensure_column(
    conn: aiosqlite.Connection,
    table: str,
    column: str,
    decl: str,
    *,
    backfill_sql: str | None = None,
) -> None:
    """Idempotent ADD COLUMN for existing desktop DBs.

    Python's bundled SQLite rejects ``ADD COLUMN IF NOT EXISTS`` even on
    recent versions, so we probe ``pragma_table_info`` instead.
    """
    async with conn.execute(f"PRAGMA table_info({table})") as cur:
        rows = await cur.fetchall()
    names = {r[1] for r in rows}
    if column in names:
        return
    await conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
    if backfill_sql:
        await conn.execute(backfill_sql)


async def _apply_schema(conn: aiosqlite.Connection) -> None:
    with open(_SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema_sql = f.read()
    await conn.executescript(schema_sql)
    # Phase 7a: pre-7a desktop DBs created projects/ideas without updated_at.
    # Fresh CREATE TABLE IF NOT EXISTS leaves those tables untouched.
    await _ensure_column(
        conn,
        "projects",
        "updated_at",
        "TEXT",
        backfill_sql=(
            "UPDATE projects SET updated_at = COALESCE(updated_at, created_at, datetime('now')) "
            "WHERE updated_at IS NULL"
        ),
    )
    await _ensure_column(
        conn,
        "ideas",
        "updated_at",
        "TEXT",
        backfill_sql=(
            "UPDATE ideas SET updated_at = COALESCE(updated_at, created_at, datetime('now')) "
            "WHERE updated_at IS NULL"
        ),
    )
    # Phase 7c: pre-7c desktop DBs lack last_pulled_at on cloud_sync_link.
    await _ensure_column(conn, "cloud_sync_link", "last_pulled_at", "TEXT")
    # Phase 7c: projects_touch/ideas_touch originally used datetime('now'),
    # which truncates to whole seconds. cloud_sync's last-write-wins compares
    # this against Postgres's microsecond-precision NOW() -- a local edit
    # landing in the same second as a just-pulled cloud timestamp could be
    # wrongly judged "not newer" purely from precision loss. schema.sql's
    # CREATE TRIGGER IF NOT EXISTS won't replace an already-existing trigger
    # on a pre-7c desktop DB, so drop and recreate explicitly here.
    await conn.execute("DROP TRIGGER IF EXISTS projects_touch")
    await conn.execute(
        """
        CREATE TRIGGER projects_touch AFTER UPDATE ON projects
        WHEN NEW.updated_at = OLD.updated_at
        BEGIN
            UPDATE projects SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
        END
        """
    )
    await conn.execute("DROP TRIGGER IF EXISTS ideas_touch")
    await conn.execute(
        """
        CREATE TRIGGER ideas_touch AFTER UPDATE ON ideas
        WHEN NEW.updated_at = OLD.updated_at
        BEGIN
            UPDATE ideas SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
        END
        """
    )
    await conn.commit()


async def get_sqlite_pool() -> SQLitePoolWrapper:
    global _pool
    if _pool is None:
        db_path = os.getenv("SQLITE_DB_PATH", "foundry_desktop.db")
        os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
        conn = await aiosqlite.connect(db_path)
        conn.row_factory = sqlite3.Row
        await conn.execute("PRAGMA foreign_keys = ON")
        await conn.execute("PRAGMA journal_mode = WAL")
        await _register_functions(conn)
        await _apply_schema(conn)
        log.info("sqlite_pool_ready", db_path=db_path)
        _pool = SQLitePoolWrapper(conn)
    return _pool


async def close_sqlite_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
