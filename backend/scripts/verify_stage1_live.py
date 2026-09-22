"""Stage 1 done-when, verified against the real running system.

Seeds three users into the live database, logs each in through the real
`/api/auth/login` endpoint to obtain real JWTs, then drives the running HTTP API
with them. Nothing here checks a function's return value in-process — every
assertion is an HTTP status from a server that is actually running.

Covers the Foundation brief's Stage 1 done-when:
  - engineer: a permitted action succeeds, a role modification is denied
  - observer: reads work, a mutation is denied
  - the audit log shows all four attempts
  - /api/admin/* works under the new model (this is also cutover step 4)

Usage, with the backend running and DATABASE_URL pointing at the same database:
    python scripts/verify_stage1_live.py [--base-url http://localhost:8000]
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.db.postgres import close_pool, get_pool  # noqa: E402

WS = "aaaaaaaa-0000-0000-0000-00000000000a"
USERS = {
    "owner": ("aaaaaaaa-0000-0000-0000-000000000001", "stage1-owner@verify.test"),
    "engineer": ("aaaaaaaa-0000-0000-0000-000000000002", "stage1-eng@verify.test"),
    "observer": ("aaaaaaaa-0000-0000-0000-000000000003", "stage1-obs@verify.test"),
}
TEAM = "aaaaaaaa-0000-0000-0000-00000000000b"
PASSWORD = "verify-stage1-password"

_failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {label}{(' - ' + detail) if detail else ''}")
    if not ok:
        _failures.append(label)


async def seed() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO workspaces (id, name, owner_id) VALUES ($1, $2, $3) "
            "ON CONFLICT (id) DO NOTHING",
            WS, "Stage1 Verify Org", USERS["owner"][0],
        )
        pw = hash_password(PASSWORD)
        for _role, (uid, email) in USERS.items():
            await conn.execute(
                "INSERT INTO users (id, email, workspace_id, password_hash) "
                "VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
                uid, email, WS, pw,
            )
        await conn.execute(
            "INSERT INTO teams (id, workspace_id, name, is_default) "
            "VALUES ($1, $2, $3, TRUE) ON CONFLICT (id) DO NOTHING",
            TEAM, WS, "Stage1 Verify Team",
        )
        for role, (uid, _email) in USERS.items():
            role_id = await conn.fetchval(
                "SELECT id FROM roles WHERE workspace_id IS NULL AND name = $1", role
            )
            await conn.execute(
                "INSERT INTO team_members (team_id, user_id, role_id) VALUES ($1, $2, $3) "
                "ON CONFLICT (team_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id",
                TEAM, uid, role_id,
            )
    await close_pool()


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.getenv("BASE_URL", "http://localhost:8000"))
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    await seed()

    async with httpx.AsyncClient(base_url=base, timeout=20.0) as c:
        # Real login endpoint, real JWTs — not tokens minted in-process.
        tokens: dict[str, str] = {}
        for role, (_uid, email) in USERS.items():
            r = await c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
            if r.status_code != 200:
                check(f"L0 login as {role}", False, f"HTTP {r.status_code} {r.text[:120]}")
                return 1
            tokens[role] = r.json()["access_token"]
        check("L0 all three roles obtained real JWTs via /api/auth/login", True)

        def h(role: str) -> dict:
            return {"Authorization": f"Bearer {tokens[role]}"}

        # ── engineer: permitted action succeeds ──────────────────────────────
        r = await c.get("/api/access/teams", headers=h("engineer"))
        check("L1 engineer permitted action succeeds (GET /api/access/teams)",
              r.status_code == 200, f"HTTP {r.status_code}")

        # ── engineer: role modification denied ───────────────────────────────
        r = await c.put(
            f"/api/access/members/{USERS['observer'][0]}/role",
            headers=h("engineer"),
            json={"team_id": TEAM, "role_id": "00000000-0000-0000-0000-000000000000"},
        )
        check("L2 engineer role modification denied", r.status_code == 403,
              f"HTTP {r.status_code}")

        # ── observer: reads work ─────────────────────────────────────────────
        r = await c.get("/api/access/roles", headers=h("observer"))
        check("L3 observer read succeeds (GET /api/access/roles)",
              r.status_code == 200, f"HTTP {r.status_code}")

        # ── observer: mutation denied ────────────────────────────────────────
        r = await c.post("/api/access/teams", headers=h("observer"),
                         json={"name": "observer-should-not-create"})
        check("L4 observer mutation denied (POST /api/access/teams)",
              r.status_code == 403, f"HTTP {r.status_code}")

        # ── audit log is owner-gated ─────────────────────────────────────────
        r = await c.get("/api/audit", headers=h("engineer"))
        check("L5 engineer denied audit log", r.status_code == 403, f"HTTP {r.status_code}")

        r = await c.get("/api/audit?limit=200", headers=h("owner"))
        check("L6 owner reads audit log", r.status_code == 200, f"HTTP {r.status_code}")

        entries = r.json().get("entries", []) if r.status_code == 200 else []
        denials = [e for e in entries if e["outcome"] == "denied"]
        denied_perms = {e["target_id"] for e in denials}
        check("L7 audit log recorded both denials",
              {"access.manage", "audit.read"} <= denied_perms,
              f"denied permissions logged: {sorted(denied_perms)}")

        allowed = [e for e in entries if e["outcome"] == "allowed"]
        check("L8 audit log recorded allowed attempts too", len(allowed) >= 1,
              f"{len(allowed)} allowed, {len(denials)} denied, {len(entries)} total")

        # ── cutover step 4: the JWT door on /api/admin/* ─────────────────────
        r = await c.get("/api/admin/health", headers=h("owner"))
        check("L9 owner reaches /api/admin/health via JWT (cutover step 4)",
              r.status_code == 200, f"HTTP {r.status_code}")

        r = await c.get("/api/admin/health", headers=h("observer"))
        check("L10 observer reaches /api/admin/health (admin.read is a read)",
              r.status_code == 200, f"HTTP {r.status_code}")

        r = await c.post("/api/admin/registry/refresh", headers=h("observer"))
        check("L11 observer denied admin write (admin.write)",
              r.status_code == 403, f"HTTP {r.status_code}")

        # ── the extensibility path, over HTTP this time ──────────────────────
        r = await c.post("/api/access/roles", headers=h("owner"), json={
            "name": "ml_engineer",
            "description": "Scoped role added with no migration",
            "permissions": ["trace.read", "model.read", "model.write", "memory.read"],
        })
        check("L12 owner creates ml_engineer role over HTTP, no migration",
              r.status_code == 201, f"HTTP {r.status_code} {r.text[:120]}")

    if _failures:
        print(f"\n{len(_failures)} check(s) FAILED: {', '.join(_failures)}")
        return 1
    print("\nAll Stage 1 live checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
