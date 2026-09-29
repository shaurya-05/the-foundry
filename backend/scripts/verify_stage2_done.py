"""Stage 2 done-when, against the real running system.

"One real end-to-end request is traceable as a single trace across every hop,
viewed in the dashboard, logged in as a Stage 1 role."

So this does exactly that, in order:

  1. Logs in through the real `/api/auth/login` as `engineer` — a Stage 1 role.
  2. Opens the real WebSocket that drives the async round-trip protocol and
     receives a genuine `tool_request` with a `call_id`.
  3. Answers it by POSTing `/api/copilot/tool-result`, which is a *separate HTTP
     request* with no shared context — the backend->frontend->backend hop.
  4. Reads the trace back through the dashboard's own API, with the engineer's
     token, and asserts it is ONE connected trace covering both legs.

Step 4 matters as much as step 3. Two spans can share a trace_id and still be
two disconnected roots, which renders as two unrelated requests in any viewer.
`root_count == 1` is the assertion that the tree actually joins.

Usage:
    python scripts/verify_stage2_done.py --base-url http://127.0.0.1:8099
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx  # noqa: E402
import websockets  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.db.postgres import close_pool, get_pool  # noqa: E402

WS_ID = "cccccccc-0000-0000-0000-00000000000a"
USER_ID = "cccccccc-0000-0000-0000-000000000001"
EMAIL = "stage2-engineer@verify.test"
TEAM_ID = "cccccccc-0000-0000-0000-00000000000b"
PASSWORD = "verify-stage2-password"

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
            WS_ID, "Stage2 Verify Org", USER_ID,
        )
        await conn.execute(
            "INSERT INTO users (id, email, workspace_id, password_hash) "
            "VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
            USER_ID, EMAIL, WS_ID, hash_password(PASSWORD),
        )
        await conn.execute(
            "INSERT INTO teams (id, workspace_id, name, is_default) "
            "VALUES ($1, $2, $3, TRUE) ON CONFLICT (id) DO NOTHING",
            TEAM_ID, WS_ID, "Stage2 Verify Team",
        )
        role_id = await conn.fetchval(
            "SELECT id FROM roles WHERE workspace_id IS NULL AND name = 'engineer'"
        )
        await conn.execute(
            "INSERT INTO team_members (team_id, user_id, role_id) VALUES ($1, $2, $3) "
            "ON CONFLICT (team_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id",
            TEAM_ID, USER_ID, role_id,
        )
    await close_pool()


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.getenv("BASE_URL", "http://127.0.0.1:8099"))
    args = ap.parse_args()
    base = args.base_url.rstrip("/")
    ws_base = base.replace("https://", "wss://").replace("http://", "ws://")

    await seed()

    async with httpx.AsyncClient(base_url=base, timeout=30.0) as c:
        # ── 1. Log in as a Stage 1 role, through the real login endpoint ────
        r = await c.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        if r.status_code != 200:
            check("D1 login as engineer", False, f"HTTP {r.status_code} {r.text[:120]}")
            return 1
        token = r.json()["access_token"]
        check("D1 logged in as a Stage 1 role (engineer)", True)

        # ── 2 + 3. Drive the real round trip across the hop ─────────────────
        call_id = None
        got_result = False
        try:
            async with websockets.connect(f"{ws_base}/api/copilot/_test_file_tool") as ws:
                await ws.send(json.dumps({
                    "token": token, "tool": "list_files", "args": {"path": "."},
                }))

                async def answer(cid: str) -> None:
                    # The second leg: a brand-new HTTP request carrying no
                    # context except the call_id the protocol already requires.
                    await c.post(
                        "/api/copilot/tool-result",
                        headers={"Authorization": f"Bearer {token}"},
                        json={"call_id": cid, "status": "ok",
                              "result": {"files": ["verify.txt"]}},
                    )

                answered = False
                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=20)
                    msg = json.loads(raw)
                    if msg.get("type") == "tool_request":
                        call_id = msg["call_id"]
                        check("D2 real tool_request received over WebSocket", True,
                              f"call_id {call_id[:8]}")
                    elif msg.get("type") == "heartbeat":
                        if call_id and not answered:
                            answered = True
                            await answer(call_id)
                    elif msg.get("type") == "tool_result":
                        got_result = msg.get("status") == "ok"
                    elif msg.get("type") == "done":
                        break
        except Exception as e:  # noqa: BLE001
            check("D2/D3 round trip completed", False, f"{type(e).__name__}: {e}")
            return 1

        check("D3 round trip completed across the hop", got_result and bool(call_id))

        # Span writes are awaited inside the span context manager, but the
        # websocket's own span closes as the socket closes -- give the loop a
        # moment rather than racing it.
        await asyncio.sleep(1.0)

        # ── 4. Read it back through the dashboard's API, as that role ───────
        h = {"Authorization": f"Bearer {token}"}

        r = await c.get("/api/observability/summary", headers=h)
        check("D4 dashboard summary readable by engineer (trace.read)",
              r.status_code == 200, f"HTTP {r.status_code}")
        summary = r.json() if r.status_code == 200 else {}

        r = await c.get("/api/observability/traces?limit=20", headers=h)
        check("D5 dashboard trace list readable", r.status_code == 200, f"HTTP {r.status_code}")
        traces = r.json().get("traces", []) if r.status_code == 200 else []
        check("D6 the request produced a trace", len(traces) >= 1, f"{len(traces)} traces")

        if not traces:
            return 1

        # Find the trace that actually contains the round trip.
        target = None
        for t in traces:
            d = (await c.get(f"/api/observability/traces/{t['trace_id']}", headers=h)).json()
            names = []

            def walk(s):
                names.append(s["name"])
                for ch in s["children"]:
                    walk(ch)

            for root in d.get("roots", []):
                walk(root)
            if any(n.startswith("tool.") for n in names) and "tool.result.received" in names:
                target = (t["trace_id"], d, names)
                break

        check("D7 one trace contains BOTH legs of the hop", target is not None,
              "no trace held the tool call and its result together"
              if target is None else "")
        if target is None:
            return 1

        trace_id, detail, names = target
        check("D8 the trace is a SINGLE connected tree, not two roots",
              detail["root_count"] == 1 and not detail["disconnected"],
              f"root_count={detail['root_count']} disconnected={detail['disconnected']}")

        # The post-hop span must be a descendant of the tool span, not a sibling.
        def find(span, name):
            if span["name"] == name:
                return span
            for ch in span["children"]:
                hit = find(ch, name)
                if hit:
                    return hit
            return None

        tool_span = None
        for root in detail["roots"]:
            tool_span = find(root, "tool.list_files")
            if tool_span:
                break
        nested = bool(tool_span and find(tool_span, "tool.result.received"))
        check("D9 the frontend's reply is nested under the tool call it answered",
              nested, f"spans in trace: {names}")

        check("D10 dashboard reports the trace in its summary counts",
              summary.get("traces", 0) >= 1 and summary.get("spans", 0) >= 2,
              f"traces={summary.get('traces')} spans={summary.get('spans')}")

        # The dashboard being readable proves trace.read is granted; it does not
        # prove the gate is real. That needs a permission this same session does
        # NOT hold. `audit.read` is owner-only by the brief's role table, so the
        # identical token must be refused there.
        #
        # (An earlier version of this check asserted engineer was refused the
        # retention sweep. That was wrong about the design, not a finding:
        # engineer holds admin.write deliberately -- "full code, deploy, trace,
        # dashboard, health access" -- and the sweep only deletes what the
        # retention policy already says is expired.)
        r = await c.get("/api/audit", headers=h)
        check("D11 same session refused audit.read (gate is real, not blanket)",
              r.status_code == 403, f"HTTP {r.status_code}")

        r = await c.post("/api/observability/retention/sweep?days=3650", headers=h)
        check("D12 engineer may run the retention sweep (admin.write, by design)",
              r.status_code == 200, f"HTTP {r.status_code}")

        # ── Metrics reach the dashboard ────────────────────────────────────
        # Driven through the real instrumented production functions, not by
        # inserting rows: log_model_usage is what every provider path calls,
        # and reflect_on_answer is what the agent loop calls. If the
        # instrumentation inside them is wrong, this fails.
        from app.services.agent_reflection import reflect_on_answer
        from app.services.ai_router import log_model_usage

        log_model_usage(
            model="qwen2.5:3b-instruct", prompt="verify stage 2",
            response="ok", latency_ms=412.0, query_type="CLASSIFIER",
        )
        reflect_on_answer(
            goal="read the config file and summarise it",
            answer="I could not read it.",
            tools_used=["read_file"],
            observations={},
        )
        await asyncio.sleep(1.5)  # let the fire-and-forget writes land

        r = await c.get("/api/observability/metrics?hours=1", headers=h)
        check("D13 metrics endpoint readable", r.status_code == 200, f"HTTP {r.status_code}")
        metrics = r.json().get("metrics", {}) if r.status_code == 200 else {}

        tiers = {
            str(row["labels"].get("tier"))
            for row in metrics.get("model.latency_ms", [])
        }
        check("D14 per-tier model latency reached the dashboard",
              "CLASSIFIER" in tiers, f"tiers seen: {sorted(tiers)}")

        criteria = {
            str(row["labels"].get("criterion"))
            for row in metrics.get("reflection.criterion", [])
        }
        check("D15 reflection metrics are per-criterion, not just pass/fail",
              len(criteria) >= 2, f"criteria seen: {sorted(criteria)}")

        print(f"\nTrace {trace_id} — {detail['span_count']} spans, single root.")

    if _failures:
        print(f"\n{len(_failures)} check(s) FAILED: {', '.join(_failures)}")
        return 1
    print("\nAll Stage 2 done-when checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
