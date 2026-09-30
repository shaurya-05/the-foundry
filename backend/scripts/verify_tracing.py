"""Verify Stage 2 tracing, especially survival across the frontend round trip.

The backend->frontend->backend hop is where tracing breaks if it breaks
anywhere: the frontend's reply arrives as a brand new HTTP request with empty
contextvars, so anything relying on ambient context is already lost by the time
the handler runs.

These checks drive the real production functions -- `create_pending_call`,
`rejoin_from_call`, `span` -- and then read the spans back out of the database,
rather than asserting on what the code returned. A trace that looks continuous
in memory and lands as two unrelated roots in the store is the exact failure
this is written to catch.

Usage, with DATABASE_URL pointing at a database that has migration 020 applied:
    python scripts/verify_tracing.py [--base-url http://127.0.0.1:8099]
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import structlog  # noqa: E402

from app.db.postgres import close_pool, get_pool  # noqa: E402
from app.services import tracing  # noqa: E402
from app.services.agent_tools import cancel_pending_call, create_pending_call  # noqa: E402

WS = "bbbbbbbb-0000-0000-0000-00000000000a"
ACTOR = "bbbbbbbb-0000-0000-0000-000000000001"

_failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {label}{(' - ' + detail) if detail else ''}")
    if not ok:
        _failures.append(label)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.getenv("BASE_URL", "http://127.0.0.1:8099"))
    args = ap.parse_args()

    # ── Leg 1: a request arrives, the agent loop runs, a tool call goes out ──
    trace_id = tracing.bind_context(
        workspace_id=WS, actor_id=ACTOR, service=tracing.SERVICE_AGENT_RUNTIME
    )

    ctxvars = structlog.contextvars.get_contextvars()
    check("T1 log context carries the four required fields",
          {"trace_id", "org_id", "actor_id", "service"} <= set(ctxvars),
          f"bound: {sorted(ctxvars)}")

    async with tracing.span("agent.loop", service=tracing.SERVICE_AGENT_RUNTIME) as loop_span:
        loop_span_id = loop_span["span_id"]
        async with tracing.span("tool.request", service=tracing.SERVICE_AGENT_RUNTIME) as tool_span:
            tool_span_id = tool_span["span_id"]
            call_id, future = create_pending_call(WS)

            # ── The hop. A new HTTP request has no contextvars at all. ──────
            tracing.clear_context()
            check("T2 context genuinely cleared before the second leg",
                  tracing.current_trace_id() is None)

            rejoined = tracing.rejoin_from_call(
                call_id, service=tracing.SERVICE_AGENT_RUNTIME
            )
            check("T3 trace recovered from call_id after the hop",
                  rejoined == trace_id, f"{rejoined} vs {trace_id}")

            async with tracing.span(
                "tool.result.received", service=tracing.SERVICE_AGENT_RUNTIME
            ) as result_span:
                result_span_id = result_span["span_id"]

            tracing.detach_call_context(call_id)
            future.cancel()

    # ── Read the spans back out of the store, not out of memory ─────────────
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT span_id, parent_span_id, name, trace_id, workspace_id, actor_id "
            "FROM spans WHERE trace_id = $1", trace_id,
        )
    by_id = {str(r["span_id"]): r for r in rows}

    check("T4 all three spans persisted under one trace_id", len(rows) == 3,
          f"{len(rows)} spans for trace {trace_id}")

    result_row = by_id.get(result_span_id)
    check("T5 the post-hop span is in the SAME trace as the pre-hop spans",
          result_row is not None and str(result_row["trace_id"]) == trace_id,
          "second leg landed in a different trace" if result_row is None else "")

    check("T6 the post-hop span hangs off the waiting span, not a second root",
          result_row is not None and str(result_row["parent_span_id"]) == tool_span_id,
          f"parent={result_row['parent_span_id'] if result_row else None} "
          f"expected={tool_span_id}")

    tool_row = by_id.get(tool_span_id)
    check("T7 span tree is intact (tool.request nested under agent.loop)",
          tool_row is not None and str(tool_row["parent_span_id"]) == loop_span_id)

    check("T8 spans carry org and actor",
          result_row is not None
          and str(result_row["workspace_id"]) == WS
          and str(result_row["actor_id"]) == ACTOR)

    # ── Cleanup contracts ──────────────────────────────────────────────────
    check("T9 detached call context cannot be rejoined",
          tracing.rejoin_from_call(call_id) is None)

    tracing.bind_context(workspace_id=WS, actor_id=ACTOR)
    timeout_call_id, timeout_future = create_pending_call(WS)
    check("T10 context attached for the timeout case",
          tracing.get_call_context(timeout_call_id) is not None)
    cancel_pending_call(timeout_call_id)
    timeout_future.cancel()
    check("T11 cancel_pending_call detaches trace context too (no leak)",
          tracing.get_call_context(timeout_call_id) is None)

    # ── Retention ──────────────────────────────────────────────────────────
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE spans SET started_at = NOW() - INTERVAL '40 days' WHERE span_id = $1",
            loop_span_id,
        )
    swept = await tracing.sweep_retention(days=30)
    async with pool.acquire() as conn:
        remaining = await conn.fetchval(
            "SELECT COUNT(*) FROM spans WHERE trace_id = $1", trace_id
        )
    check("T12 retention sweep deletes aged spans and keeps recent ones",
          swept["spans_deleted"] >= 1 and remaining == 2,
          f"deleted={swept['spans_deleted']} remaining={remaining}")

    await close_pool()

    # ── Over HTTP, against the running server ──────────────────────────────
    try:
        import httpx

        async with httpx.AsyncClient(base_url=args.base_url, timeout=10.0) as c:
            r = await c.get("/health")
            check("T13 responses carry X-Trace-Id", bool(r.headers.get("X-Trace-Id")),
                  r.headers.get("X-Trace-Id", "<missing>"))

            supplied = "11111111-2222-3333-4444-555555555555"
            r = await c.get("/health", headers={"X-Trace-Id": supplied})
            check("T14 inbound X-Trace-Id is honoured (trace continues)",
                  r.headers.get("X-Trace-Id") == supplied,
                  r.headers.get("X-Trace-Id", "<missing>"))

            r = await c.get("/health", headers={"X-Trace-Id": "not-a-uuid"})
            got = r.headers.get("X-Trace-Id", "")
            check("T15 malformed X-Trace-Id starts a clean trace, not a poisoned one",
                  got and got != "not-a-uuid", got or "<missing>")
    except Exception as e:  # noqa: BLE001
        check("T13-T15 HTTP tracing checks", False, f"server unreachable: {e}")

    if _failures:
        print(f"\n{len(_failures)} check(s) FAILED: {', '.join(_failures)}")
        return 1
    print("\nAll tracing checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
