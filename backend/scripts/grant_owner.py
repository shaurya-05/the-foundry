"""Break-glass: grant a user the `owner` role on a workspace, by direct DB write.

This exists so that cutover step 5 — removing HTTP Basic from /api/admin/* — is
reversible. On a self-hosted single-node box, a lockout otherwise means physical
access to recover. Anyone who can run this already has shell on the machine and
therefore already has the database, so it adds no attack surface; what it adds is
a documented way back in.

Usage, from backend/:

    python scripts/grant_owner.py --email you@example.com
    python scripts/grant_owner.py --email you@example.com --workspace <uuid>
    python scripts/grant_owner.py --list

Verification is deliberately a re-query after the write, not this script's own
success message. The Foundation brief is explicit that a script's own printout
does not count as evidence.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db.postgres import get_pool, close_pool  # noqa: E402


async def list_members() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT u.email, w.name AS workspace, t.name AS team, r.name AS role
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            JOIN teams t ON t.id = tm.team_id
            JOIN workspaces w ON w.id = t.workspace_id
            JOIN roles r ON r.id = tm.role_id
            ORDER BY u.email
            """
        )
    if not rows:
        print("No team memberships found.")
        return
    for r in rows:
        print(f"{r['email']:<40} {r['workspace']:<24} {r['team']:<16} {r['role']}")


async def grant_owner(email: str, workspace_id: str | None) -> int:
    pool = await get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT id, email FROM users WHERE email = $1", email)
        if not user:
            print(f"ERROR: no user with email {email}", file=sys.stderr)
            return 2

        if workspace_id:
            team = await conn.fetchrow(
                "SELECT id, workspace_id FROM teams WHERE workspace_id = $1 AND is_default",
                workspace_id,
            )
        else:
            team = await conn.fetchrow(
                """
                SELECT t.id, t.workspace_id
                FROM teams t
                JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
                WHERE wm.user_id = $1 AND t.is_default
                ORDER BY t.created_at
                LIMIT 1
                """,
                user["id"],
            )
        if not team:
            print(
                "ERROR: no default team found. Pass --workspace, or check that "
                "migration 019 has been applied.",
                file=sys.stderr,
            )
            return 3

        role = await conn.fetchrow(
            "SELECT id FROM roles WHERE workspace_id IS NULL AND name = 'owner'"
        )
        if not role:
            print("ERROR: built-in 'owner' role missing; apply migration 019.", file=sys.stderr)
            return 4

        await conn.execute(
            """
            INSERT INTO team_members (team_id, user_id, role_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (team_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id
            """,
            team["id"], user["id"], role["id"],
        )

        await conn.execute(
            """
            INSERT INTO audit_log (workspace_id, actor_id, actor_email, action,
                                   target_type, target_id, after_state, outcome)
            VALUES ($1, $2, $3, 'access.grant_owner.breakglass', 'user', $4,
                    '{"role": "owner"}'::jsonb, 'allowed')
            """,
            team["workspace_id"], user["id"], email, str(user["id"]),
        )

        # Re-query rather than trust the write. This is the verification.
        confirmed = await conn.fetch(
            """
            SELECT DISTINCT rp.permission_key
            FROM team_members tm
            JOIN teams t ON t.id = tm.team_id
            JOIN role_permissions rp ON rp.role_id = tm.role_id
            WHERE tm.user_id = $1 AND t.workspace_id = $2
            ORDER BY rp.permission_key
            """,
            user["id"], team["workspace_id"],
        )

    keys = [r["permission_key"] for r in confirmed]
    print(f"Granted owner to {email} on workspace {team['workspace_id']}")
    print(f"Verified by re-query — {len(keys)} permissions: {', '.join(keys)}")
    return 0 if "access.manage" in keys and "audit.read" in keys else 5


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--email", help="user email to grant owner to")
    ap.add_argument("--workspace", help="workspace UUID (defaults to the user's own)")
    ap.add_argument("--list", action="store_true", help="list current team memberships")
    args = ap.parse_args()

    try:
        if args.list:
            await list_members()
            return 0
        if not args.email:
            ap.error("--email is required unless --list is given")
        return await grant_owner(args.email, args.workspace)
    finally:
        await close_pool()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
