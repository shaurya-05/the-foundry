"""
Phase 7c pull-sync verification.

Prereqs (same shape as 7b):
  - Cloud API on CLOUD_API (default :8002) = Postgres, current source
  - Local API on LOCAL_API (default :8010) = SQLite, CLOUD_SYNC_ENABLED=1,
    CLOUD_SYNC_ACCESS_TOKEN matching PHASE7B_SEED / cloud account
  - Apply 018_cloud_sync_pull.sql to Postgres before running
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

    stamp = int(time.time() * 1000)
    seed_path = os.environ.get(
        "PHASE7B_SEED",
        os.path.join(os.environ.get("TEMP", "/tmp"), "phase7b_seed.json"),
    )
    seed = json.load(open(seed_path, encoding="utf-8-sig"))
    cloud_email = seed["CLOUD_EMAIL"]
    password = seed["CLOUD_PASSWORD"]
    cloud_token = seed["CLOUD_SYNC_ACCESS_TOKEN"]
    cloud_ws = seed["CLOUD_WORKSPACE_ID"]
    cloud_user = seed["CLOUD_USER_ID"]
    local_email = f"phase7c-local-{stamp}@example.com"
    db_path = os.getenv(
        "SQLITE_DB_PATH",
        os.path.join(ROOT, "desktop", "data", "phase7c_verify.db"),
    )

    print(f"[7c] cloud={CLOUD} local={LOCAL}")

    with httpx.Client(timeout=60.0) as client:
        # Confirm export exists ungated
        exp = client.get(
            f"{CLOUD}/api/cloud-sync/export",
            headers={"Authorization": f"Bearer {cloud_token}"},
            params={"table": "projects"},
        )
        if exp.status_code != 200:
            print("FAIL export", exp.status_code, exp.text[:300])
            return 2
        print("[7c] export ok count=", exp.json().get("count"))

        # pull-now gated off on cloud
        gated = client.post(
            f"{CLOUD}/api/cloud-sync/pull-now",
            headers={"Authorization": f"Bearer {cloud_token}"},
        )
        if gated.status_code != 404:
            print("FAIL expected 404 pull-now on cloud", gated.status_code)
            return 3
        print("[7c] pull-now gated on cloud (404)")

        # Local register + link
        lr = client.post(
            f"{LOCAL}/api/auth/register",
            json={"email": local_email, "password": password, "display_name": "7c Local"},
        )
        if lr.status_code >= 400:
            print("FAIL local register", lr.status_code, lr.text[:300])
            return 4
        local = lr.json()
        local_token = local["access_token"]
        local_ws = local["workspace_id"]
        local_user = local["user_id"]
        print(f"[7c] local_ws={local_ws} cloud_ws={cloud_ws}")

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
            return 5

        project_id = str(uuid.uuid4())

        async def insert_cloud_project():
            conn = await asyncpg.connect(pg_dsn())
            try:
                now = datetime.now(timezone.utc)
                await conn.execute(
                    """
                    INSERT INTO projects (
                        id, workspace_id, user_id, title, plan, status, metadata,
                        created_at, updated_at, notes
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10
                    )
                    """,
                    uuid.UUID(project_id),
                    uuid.UUID(cloud_ws),
                    uuid.UUID(cloud_user),
                    "Phase7c Cloud Project",
                    None,
                    "active",
                    "{}",
                    now,
                    now,
                    "from cloud",
                )
            finally:
                await conn.close()

        asyncio.run(insert_cloud_project())
        print(f"[7c] cloud project inserted {project_id}")

        # Pull into local
        pull = client.post(
            f"{LOCAL}/api/cloud-sync/pull-now",
            headers={"Authorization": f"Bearer {local_token}"},
        )
        if pull.status_code >= 400:
            print("FAIL pull-now", pull.status_code, pull.text[:500])
            return 6
        pull_body = pull.json()
        print("[7c] pull counts", pull_body.get("tables", {}).get("projects", {}).get("counts"))

        con = sqlite3.connect(db_path)
        row = con.execute(
            "SELECT title, notes, workspace_id FROM projects WHERE id=?",
            (project_id,),
        ).fetchone()
        con.close()
        if row is None:
            print("FAIL local row missing after pull")
            return 7
        if row[0] != "Phase7c Cloud Project":
            print("FAIL local title", row)
            return 8
        if str(row[2]) != str(local_ws):
            print("FAIL workspace not remapped to local", row[2], local_ws)
            return 9
        print("[7c] local SQLite matches cloud content; workspace remapped")

        # --- reverse LWW: local newer, cloud left older ---
        time.sleep(1.1)
        con = sqlite3.connect(db_path)
        con.execute(
            "UPDATE projects SET title=?, notes=? WHERE id=?",
            ("LOCAL NEWER TITLE", "local wins", project_id),
        )
        con.commit()
        local_u = con.execute(
            "SELECT updated_at, title FROM projects WHERE id=?",
            (project_id,),
        ).fetchone()
        # Reset pull watermark so export returns the (still older) cloud row
        con.execute(
            "UPDATE cloud_sync_link SET last_pulled_at=NULL WHERE workspace_id=?",
            (local_ws,),
        )
        con.commit()
        con.close()
        print("[7c] local after newer edit", local_u)

        pull2 = client.post(
            f"{LOCAL}/api/cloud-sync/pull-now",
            headers={"Authorization": f"Bearer {local_token}"},
        )
        if pull2.status_code >= 400:
            print("FAIL pull LWW", pull2.status_code, pull2.text[:400])
            return 10
        outcomes = {
            r["id"]: r["outcome"]
            for r in pull2.json().get("tables", {}).get("projects", {}).get("results", [])
        }
        if outcomes.get(project_id) != "skipped-older":
            print("FAIL expected skipped-older", outcomes)
            return 11
        con = sqlite3.connect(db_path)
        title = con.execute("SELECT title FROM projects WHERE id=?", (project_id,)).fetchone()[0]
        con.close()
        if title != "LOCAL NEWER TITLE":
            print("FAIL local overwritten", title)
            return 12
        print("[7c] reverse LWW OK — local newer preserved")

        # --- cache invalidation ---
        list1 = client.get(
            f"{LOCAL}/api/projects",
            headers={"Authorization": f"Bearer {local_token}"},
        )
        if list1.status_code >= 400:
            print("FAIL list projects", list1.status_code, list1.text[:200])
            return 13
        # Warm cache (second call hits cache)
        client.get(
            f"{LOCAL}/api/projects",
            headers={"Authorization": f"Bearer {local_token}"},
        )

        # Cloud newer edit, then pull
        async def cloud_newer_edit():
            conn = await asyncpg.connect(pg_dsn())
            try:
                await conn.execute(
                    "UPDATE projects SET title=$2, notes=$3 WHERE id=$1",
                    uuid.UUID(project_id),
                    "CLOUD AFTER CACHE",
                    "cache bust",
                )
            finally:
                await conn.close()

        asyncio.run(cloud_newer_edit())
        con = sqlite3.connect(db_path)
        con.execute(
            "UPDATE cloud_sync_link SET last_pulled_at=NULL WHERE workspace_id=?",
            (local_ws,),
        )
        con.commit()
        con.close()

        pull3 = client.post(
            f"{LOCAL}/api/cloud-sync/pull-now",
            headers={"Authorization": f"Bearer {local_token}"},
        )
        if pull3.status_code >= 400:
            print("FAIL pull cache", pull3.status_code, pull3.text[:400])
            return 14
        list2 = client.get(
            f"{LOCAL}/api/projects",
            headers={"Authorization": f"Bearer {local_token}"},
        )
        titles = [p.get("title") for p in list2.json()]
        if "CLOUD AFTER CACHE" not in titles:
            print("FAIL cache still stale", titles)
            return 15
        print("[7c] cache invalidated — list reflects pull")

        # --- push then pull same row ---
        time.sleep(1.1)
        con = sqlite3.connect(db_path)
        con.execute(
            "UPDATE projects SET title=?, notes=? WHERE id=?",
            ("PUSH THEN PULL", "roundtrip", project_id),
        )
        con.commit()
        # Clear push watermark so the edit is selected
        con.execute(
            "UPDATE cloud_sync_link SET last_synced_at=NULL, last_pulled_at=NULL WHERE workspace_id=?",
            (local_ws,),
        )
        con.commit()
        con.close()

        push = client.post(
            f"{LOCAL}/api/cloud-sync/push-now",
            headers={"Authorization": f"Bearer {local_token}"},
        )
        if push.status_code >= 400:
            print("FAIL push-now", push.status_code, push.text[:400])
            return 16
        pull4 = client.post(
            f"{LOCAL}/api/cloud-sync/pull-now",
            headers={"Authorization": f"Bearer {local_token}"},
        )
        if pull4.status_code >= 400:
            print("FAIL pull after push", pull4.status_code, pull4.text[:400])
            return 17
        con = sqlite3.connect(db_path)
        final = con.execute(
            "SELECT title FROM projects WHERE id=?",
            (project_id,),
        ).fetchone()[0]
        con.close()
        if final != "PUSH THEN PULL":
            print("FAIL roundtrip reverted", final)
            return 18
        print("[7c] push+pull roundtrip OK — no revert")

        # Cleanup
        async def cleanup():
            conn = await asyncpg.connect(pg_dsn())
            try:
                await conn.execute("DELETE FROM projects WHERE id=$1", uuid.UUID(project_id))
            finally:
                await conn.close()

        asyncio.run(cleanup())
        print("[7c] PASS — reused upserts/serialize; no 3-way merge; no scheduler")
        print(f"[7c] cloud account: {cloud_email} (throwaway seed)")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
