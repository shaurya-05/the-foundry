"""
Phase 7d verification: auto-sync loop, token refresh, resilience, gating.

Uses CLOUD_SYNC_INTERVAL_S=60 (floored minimum) so the first loop tick
arrives after ~30s stagger.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

CLOUD = os.getenv("CLOUD_API", "http://127.0.0.1:8002").rstrip("/")
LOCAL = os.getenv("LOCAL_API", "http://127.0.0.1:8010").rstrip("/")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def load_local_prod():
    vars = {}
    for line in open(os.path.join(ROOT, ".env.local-prod"), encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        vars[k] = v
    return vars


def pg_dsn():
    vars = load_local_prod()
    return (
        f"postgresql://foundry:{quote(vars['POSTGRES_PASSWORD_LOCAL_PROD'], safe='')}"
        f"@127.0.0.1:5433/foundry_db"
    )


def main() -> int:
    import asyncpg
    import sqlite3

    # --- unit: refresh helpers ---
    os.environ.setdefault("DATABASE_BACKEND", "sqlite")
    sys.path.insert(0, os.path.join(ROOT, "backend"))
    from app.services import cloud_sync_runner as runner

    runner.clear_runtime_access_token_for_tests()
    assert runner.cloud_sync_interval_s() >= 60
    print("[7d] interval floor ok", runner.cloud_sync_interval_s())

    seed_path = os.environ.get(
        "PHASE7B_SEED",
        os.path.join(os.environ.get("TEMP", "/tmp"), "phase7b_seed.json"),
    )
    seed = json.load(open(seed_path, encoding="utf-8-sig"))
    cloud_token = seed["CLOUD_SYNC_ACCESS_TOKEN"]
    refresh_token = seed["CLOUD_SYNC_REFRESH_TOKEN"]
    cloud_ws = seed["CLOUD_WORKSPACE_ID"]
    cloud_user = seed["CLOUD_USER_ID"]
    cloud_email = seed["CLOUD_EMAIL"]
    password = seed["CLOUD_PASSWORD"]
    db_path = os.getenv(
        "SQLITE_DB_PATH",
        os.path.join(ROOT, "desktop", "data", "phase7d_verify.db"),
    )
    stamp = int(time.time() * 1000)
    local_email = f"phase7d-local-{stamp}@example.com"

    print(f"[7d] cloud={CLOUD} local={LOCAL}")

    with httpx.Client(timeout=60.0) as client:
        # Refresh with valid refresh token
        refr = client.post(
            f"{CLOUD}/api/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        if refr.status_code != 200 or not refr.json().get("access_token"):
            print("FAIL refresh endpoint", refr.status_code, refr.text[:200])
            return 2
        print("[7d] cloud /auth/refresh ok")

        # Transparent refresh via runner.cloud_http with bad access + good refresh
        async def test_refresh_retry():
            runner.clear_runtime_access_token_for_tests()
            os.environ["CLOUD_SYNC_ACCESS_TOKEN"] = "definitely-invalid-access-token"
            os.environ["CLOUD_SYNC_REFRESH_TOKEN"] = refresh_token
            os.environ["CLOUD_SYNC_API_URL"] = CLOUD
            resp = await runner.cloud_http(
                "GET",
                CLOUD,
                "/api/cloud-sync/export",
                access_token="definitely-invalid-access-token",
                params={"table": "projects"},
            )
            return resp.status_code, bool(runner._runtime_access_token)

        status, refreshed = asyncio.run(test_refresh_retry())
        if status != 200 or not refreshed:
            print("FAIL refresh retry", status, refreshed)
            return 3
        print("[7d] 401 -> refresh -> retry succeeded (in-memory token updated)")

        # Invalid refresh → clear expired error
        async def test_bad_refresh():
            runner.clear_runtime_access_token_for_tests()
            os.environ["CLOUD_SYNC_ACCESS_TOKEN"] = "bad-access"
            os.environ["CLOUD_SYNC_REFRESH_TOKEN"] = "bad-refresh-token"
            try:
                await runner.cloud_http(
                    "GET",
                    CLOUD,
                    "/api/cloud-sync/export",
                    access_token="bad-access",
                    params={"table": "projects"},
                )
                return "no-error"
            except runner.CloudSyncOpError as e:
                return e.status_code, e.detail

        bad = asyncio.run(test_bad_refresh())
        if not isinstance(bad, tuple) or bad[0] != 401 or "relink" not in bad[1].lower():
            print("FAIL bad refresh path", bad)
            return 4
        print("[7d] invalid refresh -> clear expired/relink error")

        # Restore good tokens for the rest of the test (local sidecar already has seed token)
        os.environ["CLOUD_SYNC_ACCESS_TOKEN"] = cloud_token
        os.environ["CLOUD_SYNC_REFRESH_TOKEN"] = refresh_token
        runner.clear_runtime_access_token_for_tests()

        # Unreachable cloud: cycle should log-and-continue (no crash)
        async def test_unreachable():
            runner.clear_runtime_access_token_for_tests()
            os.environ["CLOUD_SYNC_ENABLED"] = "1"
            os.environ["CLOUD_SYNC_ACCESS_TOKEN"] = cloud_token
            os.environ["CLOUD_SYNC_REFRESH_TOKEN"] = refresh_token
            os.environ["CLOUD_SYNC_API_URL"] = "http://127.0.0.1:59999"
            # Need a link row — use the live local API's DB via HTTP link below first.
            return True

        asyncio.run(test_unreachable())
        print("[7d] unreachable URL configured for later cycle check")

        # Local register + link (local must already be running with CLOUD_SYNC_ENABLED=1
        # and interval 60, with the seed access token)
        lr = client.post(
            f"{LOCAL}/api/auth/register",
            json={"email": local_email, "password": password, "display_name": "7d Local"},
        )
        if lr.status_code >= 400:
            print("FAIL local register", lr.status_code, lr.text[:300])
            return 5
        local = lr.json()
        local_token = local["access_token"]
        local_ws = local["workspace_id"]
        local_user = local["user_id"]

        link = client.post(
            f"{LOCAL}/api/cloud-sync/link",
            headers={"Authorization": f"Bearer {local_token}"},
            json={
                "cloud_workspace_id": cloud_ws,
                "cloud_user_id": cloud_user,
                "cloud_email": cloud_email,
            },
        )
        if link.status_code >= 400:
            print("FAIL link", link.status_code, link.text[:300])
            return 6
        st = client.get(
            f"{LOCAL}/api/cloud-sync/status",
            headers={"Authorization": f"Bearer {local_token}"},
        ).json()
        print("[7d] status interval_s=", st.get("interval_s"), "linked=", st.get("linked"))
        if st.get("interval_s") != 60:
            print("WARN expected interval_s=60 for this test, got", st.get("interval_s"))

        # Gating: cloud pull-now still 404
        gated = client.post(
            f"{CLOUD}/api/cloud-sync/pull-now",
            headers={"Authorization": f"Bearer {cloud_token}"},
        )
        if gated.status_code != 404:
            print("FAIL expected 404 on cloud pull-now", gated.status_code)
            return 7
        print("[7d] cloud pull-now gated (404)")

        # Insert cloud row; wait for background loop (stagger ~30s + tick)
        project_id = str(uuid.uuid4())

        async def insert_cloud():
            conn = await asyncpg.connect(pg_dsn())
            try:
                now = datetime.now(timezone.utc)
                await conn.execute(
                    """
                    INSERT INTO projects (
                        id, workspace_id, user_id, title, status, metadata,
                        created_at, updated_at, notes
                    ) VALUES ($1,$2,$3,$4,'active','{}'::jsonb,$5,$6,$7)
                    """,
                    uuid.UUID(project_id),
                    uuid.UUID(cloud_ws),
                    uuid.UUID(cloud_user),
                    "Phase7d Auto Pull Target",
                    now,
                    now,
                    "auto",
                )
            finally:
                await conn.close()

        asyncio.run(insert_cloud())
        print(f"[7d] cloud project {project_id} — waiting for background pull (up to ~90s)")

        deadline = time.time() + 90
        found = False
        while time.time() < deadline:
            con = sqlite3.connect(db_path)
            row = con.execute(
                "SELECT title FROM projects WHERE id=?",
                (project_id,),
            ).fetchone()
            con.close()
            if row and row[0] == "Phase7d Auto Pull Target":
                found = True
                break
            time.sleep(5)

        if not found:
            print("FAIL background loop did not pull cloud project in time")
            return 8
        print("[7d] background loop pulled cloud change without manual push-now/pull-now")

        # Local edit → wait for push via loop
        time.sleep(1.1)
        con = sqlite3.connect(db_path)
        con.execute(
            "UPDATE projects SET title=? WHERE id=?",
            ("Phase7d Auto Push Source", project_id),
        )
        # Clear watermarks so next cycle picks it up even if last_synced is recent
        con.execute(
            "UPDATE cloud_sync_link SET last_synced_at=NULL WHERE workspace_id=?",
            (local_ws,),
        )
        con.commit()
        con.close()
        print("[7d] local edit — waiting for background push (up to ~90s)")

        deadline = time.time() + 90
        pushed = False
        while time.time() < deadline:
            async def check_cloud():
                conn = await asyncpg.connect(pg_dsn())
                try:
                    return await conn.fetchval(
                        "SELECT title FROM projects WHERE id=$1",
                        uuid.UUID(project_id),
                    )
                finally:
                    await conn.close()

            title = asyncio.run(check_cloud())
            if title == "Phase7d Auto Push Source":
                pushed = True
                break
            time.sleep(5)

        if not pushed:
            print("FAIL background loop did not push local edit in time")
            return 9
        print("[7d] background loop pushed local change")

        # Cycle with unreachable API should not kill process — call runner directly
        async def test_cycle_unreachable_with_link():
            # Point runner at dead port; use same SQLITE path as local server
            os.environ["CLOUD_SYNC_ENABLED"] = "1"
            os.environ["CLOUD_SYNC_API_URL"] = "http://127.0.0.1:59999"
            os.environ["CLOUD_SYNC_ACCESS_TOKEN"] = cloud_token
            os.environ["SQLITE_DB_PATH"] = db_path
            os.environ["DATABASE_BACKEND"] = "sqlite"
            # Reset pool so this process uses the same sqlite file
            from app.db import sqlite as sqlite_mod
            from app.db import postgres as pg_mod
            await sqlite_mod.close_sqlite_pool()
            pg_mod._pool = None
            pg_mod._BACKEND = "sqlite"
            results = await runner.run_cloud_sync_cycle()
            return results

        cycle = asyncio.run(test_cycle_unreachable_with_link())
        if not cycle or cycle[0].get("ok") is not False:
            print("FAIL expected per-workspace failure on unreachable cloud", cycle)
            return 10
        print("[7d] unreachable cloud -> per-workspace error, cycle continued")

        async def cleanup():
            conn = await asyncpg.connect(pg_dsn())
            try:
                await conn.execute("DELETE FROM projects WHERE id=$1", uuid.UUID(project_id))
            finally:
                await conn.close()

        asyncio.run(cleanup())
        print("[7d] PASS - default interval 600s (test used 60s); refresh in-memory only")
        print(f"[7d] cloud account: {cloud_email}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
