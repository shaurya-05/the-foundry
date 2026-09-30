"""Verify V-11: memory provenance is enforced by the DATABASE, on both backends.

The Foundation brief calls this guarantee absolute. Until Stage 4 it was a
convention held up by one well-behaved writer: `agent_memory` has no `source`
column, provenance lives inside a JSONB array, and `015_agent_memory.sql` said
in its own comment that it was "enforced by the loop once it exists, not by this
table". The database accepted an entry with no source at all.

This asserts the guarantee the way the audit log's is asserted — by trying to
break it and requiring the database to refuse.

The case that matters most is P4: an array holding one valid entry and one
without provenance. A check that only looks at the first element, or only at
whole-array shape, passes that and is worthless — it is exactly how a compactor
merging entries would slip a provenance-free row through.

Usage:
    python scripts/verify_memory_provenance.py            # both backends
    python scripts/verify_memory_provenance.py --sqlite-only
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

WS = "ffffffff-1111-0000-0000-00000000000a"
USER = "ffffffff-1111-0000-0000-000000000001"

_failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {label}{(' - ' + detail) if detail else ''}")
    if not ok:
        _failures.append(label)


CASES = [
    ("P1 entry with no source at all is refused",
     [{"text": "no source"}], False),
    ("P2 unrecognised source is refused",
     [{"text": "x", "source": "made_up"}], False),
    ("P3 valid provenance is accepted",
     [{"text": "ok", "source": "user_stated"}], True),
    ("P4 one valid entry does not smuggle an invalid one through",
     [{"text": "ok", "source": "user_stated"}, {"text": "sneaky"}], False),
    ("P5 agent_inferred is recognised",
     [{"text": "guess", "source": "agent_inferred"}], True),
    ("P6 conversation_digest is recognised",
     [{"text": "digest", "source": "conversation_digest"}], True),
]


async def run_backend(name: str, conn_factory) -> None:
    for label, content, should_accept in CASES:
        accepted = await conn_factory(content)
        check(f"[{name}] {label}", accepted is should_accept,
              "accepted" if accepted else "refused")


async def main() -> int:
    only_sqlite = "--sqlite-only" in sys.argv

    # ── SQLite ──────────────────────────────────────────────────────────────
    tmp = tempfile.mkdtemp(prefix="foundry_v11_")
    os.environ["DATABASE_BACKEND"] = "sqlite"
    os.environ["SQLITE_DB_PATH"] = os.path.join(tmp, "v11.db")

    from app.db.postgres import get_pool
    from app.db.sqlite import close_sqlite_pool

    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO workspaces (id,name,owner_id) VALUES ($1,$2,$3)", WS, "v11", USER)
        await conn.execute(
            "INSERT INTO users (id,email,workspace_id) VALUES ($1,$2,$3)",
            USER, "v11-gate@verify.test", WS)

    seq = {"n": 0}

    async def sqlite_try(content) -> bool:
        # agent_memory is UNIQUE(workspace_id, user_id), so a previous accepted
        # case would make every later one fail on the unique constraint rather
        # than on provenance -- which is exactly what happened the first time
        # this ran, and looked like the trigger rejecting valid sources.
        seq["n"] += 1
        async with pool.acquire() as c:
            await c.execute(
                "DELETE FROM agent_memory WHERE workspace_id=$1 AND user_id=$2", WS, USER)
        try:
            async with pool.acquire() as c:
                await c.execute(
                    "INSERT INTO agent_memory (id,workspace_id,user_id,content) "
                    "VALUES ($1,$2,$3,$4)",
                    f"row-{seq['n']}", WS, USER, json.dumps(content))
            return True
        except Exception:
            return False

    await run_backend("sqlite", sqlite_try)
    await close_sqlite_pool()

    if only_sqlite:
        return _report()

    # ── Postgres ────────────────────────────────────────────────────────────
    os.environ["DATABASE_BACKEND"] = "postgres"
    for mod in ("app.db.postgres", "app.db.sqlite"):
        sys.modules.pop(mod, None)
    from app.db.postgres import close_pool, get_pool as pg_pool  # noqa: E402

    pg = await pg_pool()
    async with pg.acquire() as conn:
        await conn.execute(
            "INSERT INTO workspaces (id,name,owner_id) VALUES ($1,$2,$3) "
            "ON CONFLICT (id) DO NOTHING", WS, "v11", USER)
        await conn.execute(
            "INSERT INTO users (id,email,workspace_id) VALUES ($1,$2,$3) "
            "ON CONFLICT (id) DO NOTHING", USER, "v11-gate@verify.test", WS)
        await conn.execute("DELETE FROM agent_memory WHERE workspace_id=$1", WS)

    async def pg_try(content) -> bool:
        try:
            async with pg.acquire() as c:
                await c.execute(
                    "INSERT INTO agent_memory (workspace_id,user_id,content) "
                    "VALUES ($1,$2,$3::jsonb) ON CONFLICT (workspace_id,user_id) "
                    "DO UPDATE SET content=EXCLUDED.content",
                    WS, USER, json.dumps(content))
            return True
        except Exception:
            return False

    await run_backend("postgres", pg_try)
    await close_pool()
    return _report()


def _report() -> int:
    if _failures:
        print(f"\n{len(_failures)} check(s) FAILED: {', '.join(_failures)}")
        return 1
    print("\nMemory provenance is enforced by the database, not by convention.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
