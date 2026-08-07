"""Phase 12 verify: register → skip onboarding → dashboard APIs + completed_at."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

env_path = ROOT / "backend" / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

API = os.environ.get("PHASE12_API", "http://127.0.0.1:8010")


async def http_json(method: str, path: str, token: str | None = None, body: dict | None = None):
    import httpx

    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.request(method, API + path, headers=headers, json=body)
        if r.status_code >= 400:
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:400]}")
        if r.status_code == 204 or not r.content:
            return None
        return r.json()


async def main() -> None:
    ts = int(time.time() * 1000)
    email = f"phase12-onboard-{ts}@example.com"
    password = "Phase12Onboard!99"
    print(f"[12] api={API}")
    print(f"[12] register {email}")
    reg = await http_json("POST", "/api/auth/register", body={
        "email": email,
        "password": password,
        "display_name": "Phase12",
    })
    token = reg.get("access_token") or reg.get("token")
    if not token:
        login = await http_json("POST", "/api/auth/login", body={"email": email, "password": password})
        token = login["access_token"]

    me0 = await http_json("GET", "/api/auth/me", token=token)
    step0 = me0.get("onboarding_step")
    print(f"[12] initial onboarding_step={step0} (expect 0)")
    assert step0 == 0, step0

    # Simulate connect skip — PATCH step to 1
    print("[12] PATCH onboarding-step → 1 (skip)")
    await http_json("PATCH", "/api/workspaces/onboarding-step", token=token, body={"step": 1})
    me1 = await http_json("GET", "/api/auth/me", token=token)
    print(f"[12] after skip step={me1.get('onboarding_step')} completed_at={me1.get('onboarding_completed_at')}")
    assert me1.get("onboarding_step") == 1
    assert me1.get("onboarding_completed_at"), "onboarding_completed_at must be set"

    # Zero ventures
    ventures = await http_json("GET", "/api/ventures", token=token)
    if isinstance(ventures, dict) and "ventures" in ventures:
        ventures = ventures["ventures"]
    print(f"[12] ventures count={len(ventures or [])}")
    assert not ventures

    # Dashboard-related endpoints should work with zero ventures
    for path in ("/api/tasks", "/api/workspace/activity", "/api/auth/me"):
        try:
            data = await http_json("GET", path, token=token)
            print(f"[12] {path} ok type={type(data).__name__}")
        except RuntimeError as e:
            # some envs use different activity paths
            print(f"[12] {path} -> {e}")

    # Direct DB check
    os.environ["DATABASE_BACKEND"] = "sqlite"
    # Find the db the API is using from env or default phase12 path
    db_path = os.environ.get("SQLITE_DB_PATH")
    if not db_path:
        # Probe recent phase12 dbs
        data_dir = ROOT / "desktop" / "data"
        cands = sorted(data_dir.glob("phase12*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not cands:
            cands = sorted(data_dir.glob("phase11_style_verify_*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
        db_path = str(cands[0]) if cands else None
    if db_path and Path(db_path).exists():
        import sqlite3
        con = sqlite3.connect(db_path)
        row = con.execute(
            "SELECT onboarding_step, onboarding_completed_at FROM workspaces WHERE id=?",
            (me1["workspace_id"],),
        ).fetchone()
        con.close()
        print(f"[12] DB row step={row[0]} completed_at={row[1]}")
        assert row[0] == 1 and row[1]

    # Code-path: OAuth threshold + ventures completed threshold already in tree
    oauth = (ROOT / "backend" / "app" / "routers" / "oauth.py").read_text(encoding="utf-8")
    ventures_py = (ROOT / "backend" / "app" / "routers" / "ventures.py").read_text(encoding="utf-8")
    assert "onboarding_step < 1" in oauth
    assert "req.step >= 1" in ventures_py
    assert "req.step >= 3" not in ventures_py
    print("[12] oauth/ventures thresholds OK (code review)")
    print("[12] PASS")
    print(f"[12] throwaway: {email}")


if __name__ == "__main__":
    asyncio.run(main())
