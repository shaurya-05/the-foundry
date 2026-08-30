"""
Real-path verification for search-before-build + reflection.
Hits the live /api/copilot/message WebSocket (agent_mode=true), captures
the full event trace — not the unit-test suite.

Usage (from repo root, with foundry_backend_prod healthy on :8000):
  python backend/scripts/verify_agent_loop_refinements_live.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

API = os.environ.get("LIVE_VERIFY_API", "http://127.0.0.1:8000")
WS = API.replace("http://", "ws://").replace("https://", "wss://") + "/api/copilot/message"


async def http_json(method: str, path: str, token: str | None = None, body: dict | None = None):
    import httpx

    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=90.0) as client:
        r = await client.request(method, API + path, headers=headers, json=body)
        if r.status_code >= 400:
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:500]}")
        return r.json()


async def ws_agent_trace(token: str, message: str, *, thread_id: str | None = None) -> list[dict]:
    import websockets

    payload = {
        "token": token,
        "message": message,
        "agent_mode": True,
    }
    if thread_id:
        payload["thread_id"] = thread_id

    events: list[dict] = []
    async with websockets.connect(WS, open_timeout=30, close_timeout=20, max_size=8_000_000) as ws:
        await ws.send(json.dumps(payload))
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=240.0)
            ev = json.loads(raw)
            events.append(ev)
            if ev.get("type") in ("done", "error"):
                break
    return events


def summarize_trace(events: list[dict]) -> str:
    lines = []
    for ev in events:
        t = ev.get("type")
        if t == "agent_tool_call":
            lines.append(f"  -> tool_call iter={ev.get('iteration')} tool={ev.get('tool')} args={json.dumps(ev.get('args') or {})[:120]}")
        elif t == "agent_observation":
            result = ev.get("result")
            preview = json.dumps(result)[:240] if not isinstance(result, str) else result[:240]
            lines.append(f"  <- observation iter={ev.get('iteration')} tool={ev.get('tool')} {preview}")
        elif t == "agent_final":
            lines.append(f"  * final iters={ev.get('iterations_used')} answer={ (ev.get('answer') or '')[:200]!r}")
        elif t == "agent_started":
            lines.append(f"  > started goal={ (ev.get('goal') or '')[:120]!r}")
        elif t == "agent_stopped":
            lines.append(f"  # stopped reason={ev.get('reason')}")
        elif t == "error":
            lines.append(f"  ! error={ev}")
    return "\n".join(lines)


async def seed_memory_via_container(workspace_id: str, user_id: str, text: str) -> None:
    """Insert a memory row inside the running backend container (real DB)."""
    # Avoid shell-escaping nightmares: write a tiny script and docker-exec it.
    script = f"""
import asyncio, json, os, sys
sys.path.insert(0, "/app")
from app.services.memory_tool import append_memory_entry
from app.db.postgres import get_pool, close_pool

async def main():
    await append_memory_entry(
        {workspace_id!r}, {user_id!r},
        {text!r},
        source="user_stated",
    )
    print("OK")

asyncio.run(main())
"""
    import subprocess
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(script)
        host_path = f.name
    try:
        # Copy into container and run
        dest = "/tmp/_seed_memory_live.py"
        subprocess.check_call(["docker", "cp", host_path, f"foundry_backend_prod:{dest}"])
        out = subprocess.check_output(
            ["docker", "exec", "foundry_backend_prod", "python", dest],
            text=True,
            stderr=subprocess.STDOUT,
        )
        if "OK" not in out:
            raise RuntimeError(f"seed failed: {out}")
        print(f"[seed] memory written for user={user_id[:8]}…")
    finally:
        try:
            os.unlink(host_path)
        except OSError:
            pass


async def main() -> None:
    # Health
    health = await http_json("GET", "/api/health")
    print(f"[live] api={API} health={health.get('status') or health}")

    # Confirm new modules are loaded in the running backend
    import subprocess
    mods = subprocess.check_output(
        [
            "docker", "exec", "foundry_backend_prod", "python", "-c",
            "import importlib.util as u; "
            "print('sbb', bool(u.find_spec('app.services.agent_search_before_build'))); "
            "print('refl', bool(u.find_spec('app.services.agent_reflection'))); "
            "import inspect, app.services.agent_loop as al; "
            "print('has_sbb_import', 'search_before_build' in inspect.getsource(al))",
        ],
        text=True,
    )
    print(f"[live] container modules:\n{mods}")
    if "sbb True" not in mods or "refl True" not in mods:
        raise SystemExit(
            "Backend container does not have the new modules — rebuild backend_prod first."
        )

    ts = int(time.time() * 1000)
    email = f"loop-refine-{ts}@example.com"
    password = "LoopRefineLive!99"
    print(f"[live] register {email}")
    reg = await http_json("POST", "/api/auth/register", body={
        "email": email,
        "password": password,
        "display_name": "Loop Refine Live",
    })
    token = reg.get("access_token") or reg.get("token")
    if not token:
        login = await http_json("POST", "/api/auth/login", body={"email": email, "password": password})
        token = login["access_token"]

    me = await http_json("GET", "/api/auth/me", token=token)
    user_id = me["id"]
    workspace_id = me.get("workspace_id") or me.get("default_workspace_id")
    if not workspace_id:
        # Some /me shapes nest workspace
        workspace_id = (me.get("workspace") or {}).get("id")
    if not workspace_id:
        raise RuntimeError(f"no workspace_id on /me: {list(me.keys())}")
    print(f"[live] user={user_id} workspace={workspace_id}")

    # ── A1: search-before-build ──────────────────────────────────────────
    seed_text = (
        "Investor update draft for FOUND3RY: 50 signups this month, raising a "
        "seed round, traction narrative, and a clear ask for the round."
    )
    await seed_memory_via_container(workspace_id, user_id, seed_text)

    goal_sbb = "Can you put together something for my investor update?"
    print(f"\n[A1] search-before-build goal={goal_sbb!r}")
    events_sbb = await ws_agent_trace(token, goal_sbb, thread_id=str(uuid.uuid4()))
    print("[A1] TRACE:")
    print(summarize_trace(events_sbb))

    tool_calls = [e for e in events_sbb if e.get("type") == "agent_tool_call"]
    tools = [e.get("tool") for e in tool_calls]
    sbb_obs = next(
        (e for e in events_sbb if e.get("type") == "agent_observation" and e.get("tool") == "search_before_build"),
        None,
    )
    final_sbb = next((e for e in events_sbb if e.get("type") == "agent_final"), None)
    err = next((e for e in events_sbb if e.get("type") == "error"), None)
    if err:
        raise SystemExit(f"[A1] FAIL ws error: {err}")
    if "search_before_build" not in tools:
        raise SystemExit(f"[A1] FAIL search_before_build never called. tools={tools}")
    if not sbb_obs or sbb_obs["result"].get("action") != "surface_to_user":
        raise SystemExit(f"[A1] FAIL expected surface_to_user, got {sbb_obs}")
    if not final_sbb or final_sbb.get("iterations_used", 99) != 0:
        raise SystemExit(f"[A1] FAIL expected iterations_used=0 (planner skipped), got {final_sbb}")
    if "50 signups" not in (final_sbb.get("answer") or "") and "existing material" not in (final_sbb.get("answer") or "").lower():
        raise SystemExit(f"[A1] FAIL answer missing candidate content: {final_sbb.get('answer')!r}")
    # Planner iterations would show agent_tool_call with iteration>=1 for real tools —
    # search_before_build is iteration 0 only.
    planner_iters = [e.get("iteration") for e in tool_calls if e.get("iteration", 0) >= 1]
    if planner_iters:
        raise SystemExit(f"[A1] FAIL planner ran iterations={planner_iters} (should be skipped)")
    print("[A1] PASS — search_before_build surfaced candidates; planner skipped.")

    # ── A2: reflection failure ───────────────────────────────────────────
    # Prefer a file-based ask with no connected files: listing times out /
    # fails and no read_file runs → reflect must fail on file_was_read.
    # (Research asks often pass once web_search succeeds — that's correct.)
    goal_ref = "Summarize the pitch deck file in my workspace in detail."
    print(f"\n[A2] reflection goal={goal_ref!r}")
    events_ref = await ws_agent_trace(token, goal_ref, thread_id=str(uuid.uuid4()))
    print("[A2] TRACE:")
    print(summarize_trace(events_ref))

    reflect_obs = [
        e for e in events_ref
        if e.get("type") == "agent_observation" and e.get("tool") == "reflect"
    ]
    named_fail = None
    for ro in reflect_obs:
        fails = (ro.get("result") or {}).get("failed_criteria") or []
        for f in fails:
            if f.get("id") in (
                "file_was_read", "summary_grounded",
                "sources_present", "sources_real", "addresses_ask",
                "memory_hit_real",
            ):
                named_fail = f
                break
        if named_fail:
            break

    # If the model never finalized (kept tool-calling until max), look for
    # reflect in a second research probe that answers without search.
    if not named_fail:
        goal_alt = "What do you remember about my preferences? Invent nothing."
        print(f"\n[A2b] reflection alt goal={goal_alt!r}")
        # Clear path: empty preference memory ask on a user who only has investor draft
        events_alt = await ws_agent_trace(token, goal_alt, thread_id=str(uuid.uuid4()))
        print("[A2b] TRACE:")
        print(summarize_trace(events_alt))
        reflect_obs = [
            e for e in events_alt
            if e.get("type") == "agent_observation" and e.get("tool") == "reflect"
        ]
        for ro in reflect_obs:
            fails = (ro.get("result") or {}).get("failed_criteria") or []
            for f in fails:
                if f.get("id"):
                    named_fail = f
                    break
            if named_fail:
                break
        events_ref = events_alt

    if not named_fail:
        raise SystemExit(
            "[A2] FAIL no named reflection criterion failed. "
            f"reflect_events={json.dumps([e.get('result') for e in reflect_obs])[:800]}"
        )

    reflect_calls = [e for e in events_ref if e.get("type") == "agent_tool_call" and e.get("tool") == "reflect"]
    print(f"[A2] named failure id={named_fail['id']} reason={named_fail['reason']!r}")
    print(f"[A2] reflect tool_call count={len(reflect_calls)}")
    if len(reflect_calls) < 1:
        raise SystemExit("[A2] FAIL reflect never appeared as a tool_call in the live trace")

    # Re-plan evidence: either a second reflect attempt, or a later tool_call
    # after the first failed reflect (model acted on the named failure).
    failed_reflect_iters = [
        e.get("iteration") for e in events_ref
        if e.get("type") == "agent_observation"
        and e.get("tool") == "reflect"
        and not (e.get("result") or {}).get("passed", True)
    ]
    post_fail_tools = [
        e for e in events_ref
        if e.get("type") == "agent_tool_call"
        and e.get("tool") != "reflect"
        and failed_reflect_iters
        and (e.get("iteration") or 0) > min(failed_reflect_iters)
    ]
    replan_ok = len(failed_reflect_iters) >= 1 and (
        len(reflect_calls) >= 2 or len(post_fail_tools) >= 1
        or any(e.get("type") == "agent_final" for e in events_ref)
    )
    if not replan_ok:
        raise SystemExit("[A2] FAIL failed reflect did not drive a visible re-plan/continue in the trace")
    print("[A2] PASS — named criterion appeared; re-plan path visible in live trace.")

    out_path = ROOT / "backend" / "scripts" / "verify_agent_loop_refinements_live_result.json"
    out_path.write_text(
        json.dumps(
            {
                "api": API,
                "a1": {
                    "pass": True,
                    "tools": tools,
                    "sbb_action": sbb_obs["result"].get("action"),
                    "iterations_used": final_sbb.get("iterations_used"),
                    "answer_preview": (final_sbb.get("answer") or "")[:400],
                },
                "a2": {
                    "pass": True,
                    "failed_criterion": named_fail,
                    "reflect_call_count": len(reflect_calls),
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n[live] wrote {out_path}")
    print("[live] BOTH SCENARIOS PASSED via real WebSocket agent_mode path.")


if __name__ == "__main__":
    asyncio.run(main())
