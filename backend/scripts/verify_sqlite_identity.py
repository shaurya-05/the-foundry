"""Verify the SQLite backend builds a cold identity model and enforces it.

This is the SQLite half of the Stage 1 gate. It exists because
`migrations/sqlite/schema.sql` was not covered by CI at all — the Postgres glob
does not recurse — which is the same green-but-hollow exposure Stage 0 was
created to eliminate, one directory down.

It does not check that tables exist. It drives `app.services.access`, the actual
production permission-resolution code, against a database created from nothing,
through the real aiosqlite adapter including its $N-placeholder translation. If
this passes, the desktop build enforces permissions; if it fails, the desktop
build is broken and CI says so.

Run from backend/:  python scripts/verify_sqlite_identity.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_TMP = tempfile.mkdtemp(prefix="foundry_sqlite_verify_")
os.environ["DATABASE_BACKEND"] = "sqlite"
os.environ["SQLITE_DB_PATH"] = os.path.join(_TMP, "verify.db")

from app.db.postgres import get_pool  # noqa: E402
from app.db.sqlite import close_sqlite_pool  # noqa: E402
from app.services.access import has_permission, user_permissions  # noqa: E402

WS = "11111111-1111-1111-1111-111111111111"
U_OWNER = "22222222-2222-2222-2222-222222222222"
U_ENG = "33333333-3333-3333-3333-333333333333"
U_OBS = "44444444-4444-4444-4444-444444444444"
TEAM = "55555555-5555-5555-5555-555555555555"

_failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {label}{(' - ' + detail) if detail else ''}")
    if not ok:
        _failures.append(label)


async def seed(conn) -> None:
    await conn.execute(
        "INSERT INTO workspaces (id, name, owner_id) VALUES ($1, $2, $3)",
        WS, "Verify Org", U_OWNER,
    )
    for uid, email in ((U_OWNER, "owner@verify.test"),
                       (U_ENG, "eng@verify.test"),
                       (U_OBS, "obs@verify.test")):
        await conn.execute(
            "INSERT INTO users (id, email, workspace_id) VALUES ($1, $2, $3)",
            uid, email, WS,
        )
    await conn.execute(
        "INSERT INTO teams (id, workspace_id, name, is_default) VALUES ($1, $2, $3, 1)",
        TEAM, WS, "Default",
    )
    for uid, role in ((U_OWNER, "owner"), (U_ENG, "engineer"), (U_OBS, "observer")):
        role_id = await conn.fetchval(
            "SELECT id FROM roles WHERE workspace_id IS NULL AND name = $1", role
        )
        await conn.execute(
            "INSERT INTO team_members (team_id, user_id, role_id) VALUES ($1, $2, $3)",
            TEAM, uid, role_id,
        )


async def main() -> int:
    pool = await get_pool()

    async with pool.acquire() as conn:
        # S1 — cold build seeded the built-ins
        roles = await conn.fetchval("SELECT COUNT(*) FROM roles WHERE is_builtin = 1")
        perms = await conn.fetchval("SELECT COUNT(*) FROM permissions")
        grants = await conn.fetchval("SELECT COUNT(*) FROM role_permissions")
        check("S1 cold build seeds roles/permissions/grants",
              (roles, perms, grants) == (3, 10, 21),
              f"{roles}/{perms}/{grants}, expected 3/10/21")

        await seed(conn)

    # S2..S4 — drive the real production permission code, not a local query
    check("S2 engineer has deploy.execute, not access.manage",
          await has_permission(U_ENG, WS, "deploy.execute")
          and not await has_permission(U_ENG, WS, "access.manage"))

    check("S3 observer has trace.read, not memory.write",
          await has_permission(U_OBS, WS, "trace.read")
          and not await has_permission(U_OBS, WS, "memory.write"))

    owner_perms = await user_permissions(U_OWNER, WS)
    obs_perms = await user_permissions(U_OBS, WS)
    check("S4 audit.read is owner-only",
          "audit.read" in owner_perms and "audit.read" not in obs_perms,
          f"owner={len(owner_perms)} perms, observer={len(obs_perms)} perms")

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO audit_log (workspace_id, actor_id, action, outcome) "
            "VALUES ($1, $2, 'verify.test', 'allowed')",
            WS, U_OWNER,
        )

        # S5/S6 — append-only must be enforced by the database, not by callers
        try:
            await conn.execute("UPDATE audit_log SET action = 'tampered' WHERE action = 'verify.test'")
            check("S5 UPDATE audit_log rejected", False, "update succeeded")
        except Exception as e:
            check("S5 UPDATE audit_log rejected", "append-only" in str(e), str(e)[:60])

        try:
            await conn.execute("DELETE FROM audit_log WHERE action = 'verify.test'")
            check("S6 DELETE audit_log rejected", False, "delete succeeded")
        except Exception as e:
            check("S6 DELETE audit_log rejected", "append-only" in str(e), str(e)[:60])

        # S7 — built-in roles undeletable
        try:
            await conn.execute("DELETE FROM roles WHERE name = 'owner' AND workspace_id IS NULL")
            check("S7 built-in role delete rejected", False, "delete succeeded")
        except Exception as e:
            check("S7 built-in role delete rejected", "built-in role" in str(e), str(e)[:60])

        # S8 — the brief's design test: a fourth role with no schema change
        await conn.execute(
            "INSERT INTO roles (workspace_id, name, description, is_builtin) "
            "VALUES ($1, 'robotics_engineer', 'Phase C scoped role', 0)", WS,
        )
        await conn.execute(
            "INSERT INTO role_permissions (role_id, permission_key) "
            "SELECT r.id, p.key FROM roles r CROSS JOIN permissions p "
            "WHERE r.name = 'robotics_engineer' "
            "AND p.key IN ('trace.read', 'model.read', 'deploy.execute')"
        )
        n = await conn.fetchval(
            "SELECT COUNT(*) FROM roles r JOIN role_permissions rp ON rp.role_id = r.id "
            "WHERE r.name = 'robotics_engineer'"
        )
        check("S8 fourth role added with no migration", n == 3, f"{n} permissions")

        # S9 — the audit row survived both tamper attempts, unmodified
        rows = await conn.fetch("SELECT action FROM audit_log WHERE action = 'verify.test'")
        check("S9 audit row intact after tampering", len(rows) == 1, f"{len(rows)} row(s)")

    await close_sqlite_pool()

    if _failures:
        print(f"\n{len(_failures)} check(s) FAILED: {', '.join(_failures)}")
        return 1
    print("\nAll SQLite identity checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
