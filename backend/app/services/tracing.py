"""Distributed tracing — Stage 2.

One request is one trace. Spans form a tree through `parent_span_id`, so the
agent loop's plan/act/observe/reflect becomes a readable span tree rather than
an ad-hoc event stream.

Propagation uses `contextvars`, which structlog is already configured to merge
(`structlog.contextvars.merge_contextvars` in main.py). Binding once per request
therefore puts `trace_id`, `org_id`, `actor_id` and `service` on every log line
emitted anywhere downstream, including inside async tasks, without threading a
context object through forty call sites.

**The hard part: the backend→frontend→backend hop.** The async round-trip
protocol sends a `tool_request` to the frontend and waits; the frontend answers
by POSTing to `/api/copilot/tool-result`, which arrives as a *new* HTTP request
with empty contextvars. A naive implementation loses the trace exactly there.

This module solves it without trusting the client. `call_id` already round-trips
by necessity — the protocol cannot work without it — so the trace context is
stashed against the call_id server-side when the pending call is created, and
recovered from it when the result arrives. The frontend cannot drop it, reorder
it, or forge someone else's, because it never carries it.

That does inherit the pending-call registry's existing single-worker assumption:
both live in module-level dicts. They fail together rather than one silently
degrading, which is the better of the two options — a trace that goes missing
while the request still works is the kind of bug you chase for a week.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any, Optional

import structlog

from app.db.postgres import get_pool

log = structlog.get_logger()

# ─── Service names — the five Stage 3 contexts ───────────────────────────────
SERVICE_IDENTITY = "identity_access"
SERVICE_MODEL_GATEWAY = "model_gateway"
SERVICE_AGENT_RUNTIME = "agent_runtime"
SERVICE_MEMORY = "memory_knowledge"
SERVICE_PERCEPTION = "perception_actuation"
SERVICE_API = "api"

_trace_id: ContextVar[Optional[str]] = ContextVar("trace_id", default=None)
_span_id: ContextVar[Optional[str]] = ContextVar("span_id", default=None)
_workspace_id: ContextVar[Optional[str]] = ContextVar("ws_id", default=None)
_actor_id: ContextVar[Optional[str]] = ContextVar("actor_id", default=None)

# Trace context stashed against a pending frontend call_id, so the second leg of
# the round trip can rejoin the trace it belongs to. Same lifetime as the
# pending-call registry it shadows; cleaned up by detach_call_context().
_CALL_TRACE_CONTEXT: dict[str, dict[str, Optional[str]]] = {}

RETENTION_DAYS = int(os.getenv("TRACE_RETENTION_DAYS", "7"))


def current_trace_id() -> Optional[str]:
    return _trace_id.get()


def current_span_id() -> Optional[str]:
    return _span_id.get()


def new_trace_id() -> str:
    return str(uuid.uuid4())


def bind_context(
    *,
    trace_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    service: str = SERVICE_API,
) -> str:
    """Bind trace context for everything downstream in this async context.

    Also binds into structlog's contextvars, which is what puts the four
    required fields on every log line without any call site knowing about it.
    """
    tid = trace_id or new_trace_id()
    _trace_id.set(tid)
    if workspace_id is not None:
        _workspace_id.set(workspace_id)
    if actor_id is not None:
        _actor_id.set(actor_id)

    structlog.contextvars.bind_contextvars(
        trace_id=tid,
        org_id=workspace_id,
        actor_id=actor_id,
        service=service,
    )
    return tid


def clear_context() -> None:
    structlog.contextvars.clear_contextvars()
    _trace_id.set(None)
    _span_id.set(None)
    _workspace_id.set(None)
    _actor_id.set(None)


# ─── The backend → frontend → backend hop ────────────────────────────────────
def attach_call_context(call_id: str) -> None:
    """Stash the current trace context against a pending frontend call."""
    _CALL_TRACE_CONTEXT[call_id] = {
        "trace_id": _trace_id.get(),
        "parent_span_id": _span_id.get(),
        "workspace_id": _workspace_id.get(),
        "actor_id": _actor_id.get(),
    }


def get_call_context(call_id: str) -> Optional[dict[str, Optional[str]]]:
    return _CALL_TRACE_CONTEXT.get(call_id)


def detach_call_context(call_id: str) -> None:
    """Safe to call more than once, or on a call_id that was never attached —
    matching cancel_pending_call()'s contract, since the two are cleaned up on
    the same paths including timeout and abort."""
    _CALL_TRACE_CONTEXT.pop(call_id, None)


def rejoin_from_call(call_id: str, *, service: str = SERVICE_API) -> Optional[str]:
    """Rebind the trace that a pending call belongs to.

    Called by the tool-result endpoint before it does anything else, so the
    second leg's log lines and spans land in the originating trace rather than
    in a new one that looks unrelated.
    """
    ctx = _CALL_TRACE_CONTEXT.get(call_id)
    if not ctx or not ctx.get("trace_id"):
        return None
    bind_context(
        trace_id=ctx["trace_id"],
        workspace_id=ctx.get("workspace_id"),
        actor_id=ctx.get("actor_id"),
        service=service,
    )
    # Hang this leg off the span that was waiting, so the tree shows the
    # round trip as a child of the tool call rather than as a second root.
    if ctx.get("parent_span_id"):
        _span_id.set(ctx["parent_span_id"])
    return ctx["trace_id"]


# ─── Spans ───────────────────────────────────────────────────────────────────
async def _write_span(row: dict[str, Any]) -> None:
    """Persist one span. Never raises into the caller.

    A span write that fails must not fail the request it is describing — the
    observability layer reporting an outage it caused itself is worse than the
    missing row. Failures are logged instead, which is also how you find out the
    spans table is full rather than wondering why traces look thin.
    """
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO spans (span_id, trace_id, parent_span_id, service, name,
                                   workspace_id, actor_id, started_at, ended_at,
                                   duration_ms, status, error, attributes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
                """,
                row["span_id"], row["trace_id"], row["parent_span_id"], row["service"],
                row["name"], row["workspace_id"], row["actor_id"], row["started_at"],
                row["ended_at"], row["duration_ms"], row["status"], row["error"],
                json.dumps(row["attributes"]),
            )
    except Exception as e:  # noqa: BLE001 — deliberate, see docstring
        log.warning("span_write_failed", span_name=row.get("name"), error=str(e))


@asynccontextmanager
async def span(name: str, *, service: str = SERVICE_API, **attributes: Any):
    """Record one span, nested under whatever span is currently active.

    Usage:
        async with span("model.complete", service=SERVICE_MODEL_GATEWAY,
                        tier="FACTUAL") as s:
            ...
            s["attributes"]["tokens"] = 412
    """
    from datetime import datetime, timezone

    sid = str(uuid.uuid4())
    parent = _span_id.get()
    tid = _trace_id.get() or bind_context(service=service)

    token = _span_id.set(sid)
    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()
    record: dict[str, Any] = {
        "span_id": sid,
        "trace_id": tid,
        "parent_span_id": parent,
        "service": service,
        "name": name,
        "workspace_id": _workspace_id.get(),
        "actor_id": _actor_id.get(),
        "started_at": started,
        "ended_at": None,
        "duration_ms": None,
        "status": "ok",
        "error": None,
        "attributes": dict(attributes),
    }
    try:
        yield record
    except Exception as e:
        record["status"] = "error"
        record["error"] = f"{type(e).__name__}: {e}"[:2000]
        raise
    finally:
        _span_id.reset(token)
        record["ended_at"] = datetime.now(timezone.utc)
        record["duration_ms"] = (time.perf_counter() - t0) * 1000.0
        await _write_span(record)


# ─── Metrics ─────────────────────────────────────────────────────────────────
async def record_metric(
    metric: str, value: float, **labels: Any
) -> None:
    """Record a point-in-time measurement that is not a span duration.

    VRAM samples, circuit-breaker transitions and reflection-criterion outcomes
    belong here: they attach to a moment, not to a request.
    """
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO metric_samples (metric, value, labels, trace_id) "
                "VALUES ($1, $2, $3::jsonb, $4)",
                metric, float(value), json.dumps(labels), _trace_id.get(),
            )
    except Exception as e:  # noqa: BLE001
        log.warning("metric_write_failed", metric=metric, error=str(e))


def record_metric_nowait(metric: str, value: float, **labels: Any) -> None:
    """Fire-and-forget metric write from synchronous code.

    Several of the places worth measuring are sync functions on a hot path --
    `log_model_usage` is the obvious one. Blocking them on a database insert to
    record how fast they were would be self-defeating, so the write is scheduled
    on the running loop instead.

    If there is no running loop (a unit test, a CLI script), the sample is
    dropped rather than raising. Losing a metric is acceptable; breaking the
    thing being measured is not.
    """
    try:
        import asyncio

        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(record_metric(metric, value, **labels))
    # Hold a reference so the task is not garbage-collected mid-flight, and
    # drop it on completion. Without this, CPython can collect a pending task
    # and the write silently never happens -- which looks exactly like the
    # metric never firing.
    _INFLIGHT.add(task)
    task.add_done_callback(_INFLIGHT.discard)


_INFLIGHT: set = set()


# ─── Retention ───────────────────────────────────────────────────────────────
async def sweep_retention(days: Optional[int] = None) -> dict[str, int]:
    """Delete spans and metric samples older than the retention window.

    Defined and implemented up front rather than deferred. Traces are large, the
    host is one machine, and an observability layer that fills the disk it is
    meant to be observing is a particularly bad way to learn this lesson.
    """
    from datetime import datetime, timedelta, timezone

    keep = days if days is not None else RETENTION_DAYS
    cutoff = datetime.now(timezone.utc) - timedelta(days=keep)

    # The cutoff is computed in Python and passed as a parameter rather than
    # expressed as `NOW() - interval`, and the counts are taken before the
    # delete rather than via `WITH ... DELETE ... RETURNING`. Both of those are
    # Postgres-only, and the desktop build runs this same code against SQLite.
    pool = await get_pool()
    async with pool.acquire() as conn:
        spans_deleted = await conn.fetchval(
            "SELECT COUNT(*) FROM spans WHERE started_at < $1", cutoff
        )
        await conn.execute("DELETE FROM spans WHERE started_at < $1", cutoff)
        metrics_deleted = await conn.fetchval(
            "SELECT COUNT(*) FROM metric_samples WHERE recorded_at < $1", cutoff
        )
        await conn.execute("DELETE FROM metric_samples WHERE recorded_at < $1", cutoff)
    log.info("trace_retention_swept", days=keep,
             spans_deleted=spans_deleted, metrics_deleted=metrics_deleted)
    return {"retention_days": keep, "spans_deleted": int(spans_deleted or 0),
            "metrics_deleted": int(metrics_deleted or 0)}
