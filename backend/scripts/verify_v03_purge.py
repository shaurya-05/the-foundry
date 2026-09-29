"""Verify V-03: cross-service deletion and export actually work.

This is GDPR-critical code. The path it replaces reported `{"deleted": true}`
while wrapping every delete in `try/except: pass` and covering seven tables out
of roughly thirty — so it could, and on a database missing a table did, delete
nothing and say it had succeeded.

Every assertion here is a **direct database count taken after the fact**, never
the endpoint's own return value. An endpoint reporting on its own deletion is
precisely the thing that failed before.

Usage, against a running server:
    python scripts/verify_v03_purge.py --base-url http://127.0.0.1:8099
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

WS = "dddddddd-0000-0000-0000-00000000000a"
OWNER = "dddddddd-0000-0000-0000-000000000001"   # second owner, so the leaver may leave
LEAVER = "dddddddd-0000-0000-0000-000000000002"
TEAM = "dddddddd-0000-0000-0000-00000000000b"
PASSWORD = "verify-v03-password"

# Tables seeded for the leaver, spanning three services.
SEEDED = {
    "agent_runtime": ["copilot_messages", "agent_runs", "forge_outputs"],
    "memory_knowledge": ["agent_memory", "knowledge_items"],
    "workspace_domain": ["projects", "tasks", "ideas", "notifications"],
}

_failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {label}{(' - ' + detail) if detail else ''}")
    if not ok:
        _failures.append(label)


async def seed() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO workspaces (id, name, owner_id) VALUES ($1,$2,$3) "
            "ON CONFLICT (id) DO NOTHING", WS, "V03 Verify Org", OWNER)
        pw = hash_password(PASSWORD)
        for uid, email in ((OWNER, "v03-owner@verify.test"), (LEAVER, "v03-leaver@verify.test")):
            await conn.execute(
                "INSERT INTO users (id,email,workspace_id,password_hash) VALUES ($1,$2,$3,$4) "
                "ON CONFLICT (id) DO UPDATE SET deleted_at=NULL, password_hash=EXCLUDED.password_hash, "
                "email=EXCLUDED.email", uid, email, WS, pw)
            # Two owners, so the sole-owner guard does not block the deletion.
            await conn.execute(
                "INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner') "
                "ON CONFLICT (workspace_id,user_id) DO UPDATE SET role='owner'", WS, uid)
        await conn.execute(
            "INSERT INTO teams (id,workspace_id,name,is_default) VALUES ($1,$2,$3,TRUE) "
            "ON CONFLICT (id) DO NOTHING", TEAM, WS, "V03 Team")

        # Data belonging to the leaver, across three services.
        await conn.execute(
            "INSERT INTO copilot_messages (workspace_id,user_id,role,content) "
            "VALUES ($1,$2,'user','v03 probe')", WS, LEAVER)
        await conn.execute(
            "INSERT INTO agent_runs (workspace_id,user_id,agent_id,context,output) "
            "VALUES ($1,$2,'probe','{}','{}')", WS, LEAVER)
        await conn.execute(
            "INSERT INTO forge_outputs (workspace_id,user_id,type,input,output) "
            "VALUES ($1,$2,'probe','{}','{}')", WS, LEAVER)
        # agent_memory is ONE row per (workspace, user) holding a JSONB array;
        # `source` lives inside each array element, not in a column. See V-11.
        await conn.execute(
            "INSERT INTO agent_memory (workspace_id,user_id,content) "
            "VALUES ($1,$2,$3::jsonb) ON CONFLICT (workspace_id,user_id) "
            "DO UPDATE SET content=EXCLUDED.content",
            WS, LEAVER,
            '[{"text":"v03 probe","source":"user_stated"}]')
        await conn.execute(
            "INSERT INTO knowledge_items (workspace_id,user_id,title,content) "
            "VALUES ($1,$2,'v03 probe','body')", WS, LEAVER)
        await conn.execute(
            "INSERT INTO projects (workspace_id,user_id,title) VALUES ($1,$2,'v03 probe')", WS, LEAVER)
        await conn.execute(
            "INSERT INTO tasks (workspace_id,user_id,title) VALUES ($1,$2,'v03 probe')", WS, LEAVER)
        await conn.execute(
            "INSERT INTO ideas (workspace_id,user_id,domains,content) "
            "VALUES ($1,$2,'{probe}','v03 probe')", WS, LEAVER)
        await conn.execute(
            "INSERT INTO notifications (workspace_id,user_id,type,title) "
            "VALUES ($1,$2,'probe','v03 probe')", WS, LEAVER)

        # One row belonging to the OTHER member, in a table the leaver also uses.
        # It must survive: purging a departing member must not take a colleague's
        # data with it.
        await conn.execute(
            "INSERT INTO projects (workspace_id,user_id,title) VALUES ($1,$2,'colleague keep')",
            WS, OWNER)


async def counts(user_id: str) -> dict[str, int]:
    pool = await get_pool()
    out: dict[str, int] = {}
    async with pool.acquire() as conn:
        for tables in SEEDED.values():
            for t in tables:
                out[t] = int(await conn.fetchval(
                    f"SELECT COUNT(*) FROM {t} WHERE workspace_id=$1 AND user_id=$2",
                    WS, user_id) or 0)
    return out


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.getenv("BASE_URL", "http://127.0.0.1:8099"))
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    await seed()
    before = await counts(LEAVER)
    colleague_before = await counts(OWNER)
    check("P1 seeded data across three services",
          sum(before.values()) >= 9, f"{sum(before.values())} rows in {len(before)} tables")

    async with httpx.AsyncClient(base_url=base, timeout=60.0) as c:
        r = await c.post("/api/auth/login",
                         json={"email": "v03-leaver@verify.test", "password": PASSWORD})
        if r.status_code != 200:
            check("P2 leaver logs in", False, f"HTTP {r.status_code} {r.text[:120]}")
            await close_pool()
            return 1
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        check("P2 leaver logs in", True)

        # ── Export must contain data from every service ─────────────────────
        r = await c.get("/api/auth/export", headers=h)
        check("P3 export returns 200", r.status_code == 200, f"HTTP {r.status_code}")
        payload = r.json() if r.status_code == 200 else {}
        services = payload.get("services", {})
        check("P4 export is assembled per service, not per table guess",
              set(services) == set(SEEDED), f"services: {sorted(services)}")
        for svc, tables in SEEDED.items():
            got = set(services.get(svc, {}))
            check(f"P5 export includes {svc} data",
                  any(t in got for t in tables), f"tables: {sorted(got)}")

        # ── Delete, then verify by direct query ─────────────────────────────
        r = await c.request("DELETE", "/api/auth/me", headers=h,
                            json={"password": PASSWORD})
        check("P6 delete returns 200", r.status_code == 200,
              f"HTTP {r.status_code} {r.text[:160]}")
        body = r.json() if r.status_code == 200 else {}
        check("P7 delete reports which services it purged",
              len(body.get("services_purged", [])) == 3,
              str([s.get("service") for s in body.get("services_purged", [])]))

    after = await counts(LEAVER)
    colleague_after = await counts(OWNER)

    leftovers = {t: n for t, n in after.items() if n > 0}
    check("P8 EVERY seeded row is actually gone (direct query, not the endpoint's word)",
          not leftovers, f"still present: {leftovers}" if leftovers else "")

    check("P9 the colleague's data survived",
          colleague_after.get("projects", 0) == colleague_before.get("projects", 0)
          and colleague_after.get("projects", 0) > 0,
          f"colleague projects before={colleague_before.get('projects')} "
          f"after={colleague_after.get('projects')}")

    pool = await get_pool()
    async with pool.acquire() as conn:
        soft = await conn.fetchrow(
            "SELECT deleted_at, password_hash FROM users WHERE id=$1", LEAVER)
        member = await conn.fetchval(
            "SELECT COUNT(*) FROM workspace_members WHERE user_id=$1", LEAVER)
    check("P10 identity itself is closed out (soft-deleted, credentials cleared, membership gone)",
          soft and soft["deleted_at"] is not None and soft["password_hash"] is None
          and int(member or 0) == 0)

    await close_pool()

    if _failures:
        print(f"\n{len(_failures)} check(s) FAILED: {', '.join(_failures)}")
        return 1
    print(f"\nV-03 verified: {sum(before.values())} rows across three services, all gone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
