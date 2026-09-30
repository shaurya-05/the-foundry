"""Observability API — Stage 2.

Traces, span trees and metrics, gated by `trace.read` from the Stage 1 model.
Same identity, same session, same login as everything else: there is no separate
observability account and no second tool per concern.

Every query here avoids Postgres-only SQL — no `ARRAY_AGG ... FILTER`, no
`percentile_cont`, no `NOW() - interval`. The desktop build runs this same code
against SQLite, and a dashboard that works on the server and 500s on the desktop
is the split Stage 1 and 2 have both spent effort closing.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query

from app.db.postgres import get_pool
from app.services.identity import AuthContext, RequirePermission

log = structlog.get_logger()
router = APIRouter(prefix="/api/observability", tags=["observability"])


def _loads(value: Any) -> Any:
    """asyncpg hands back JSONB as a string unless a codec is registered, and
    the SQLite backend stores it as TEXT. Both arrive here as str."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return {}
    return value or {}


@router.get("/traces")
async def list_traces(
    auth: AuthContext = Depends(RequirePermission("trace.read")),
    limit: int = Query(50, ge=1, le=500),
    only_errors: bool = False,
):
    """Recent traces for this workspace, newest first.

    Two queries and a merge in Python rather than one clever aggregate: the
    root span's name is what makes a trace identifiable in a list, and pulling
    it with `string_agg`/`DISTINCT ON` would tie this to Postgres.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        traces = await conn.fetch(
            """
            SELECT trace_id,
                   MIN(started_at) AS started_at,
                   COUNT(*) AS span_count,
                   SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
                   MAX(duration_ms) AS duration_ms
            FROM spans
            WHERE workspace_id = $1
            GROUP BY trace_id
            ORDER BY MIN(started_at) DESC
            LIMIT $2
            """,
            auth.workspace_id, limit,
        )
        if not traces:
            return {"traces": []}

        roots = await conn.fetch(
            """
            SELECT trace_id, name, service
            FROM spans
            WHERE workspace_id = $1 AND parent_span_id IS NULL
            """,
            auth.workspace_id,
        )

    root_by_trace = {str(r["trace_id"]): r for r in roots}
    out = []
    for t in traces:
        tid = str(t["trace_id"])
        errors = int(t["error_count"] or 0)
        if only_errors and errors == 0:
            continue
        root = root_by_trace.get(tid)
        out.append({
            "trace_id": tid,
            "started_at": t["started_at"],
            "span_count": int(t["span_count"] or 0),
            "error_count": errors,
            "duration_ms": t["duration_ms"],
            "root_name": root["name"] if root else None,
            "root_service": root["service"] if root else None,
        })
    return {"traces": out}


@router.get("/traces/{trace_id}")
async def get_trace(
    trace_id: str,
    auth: AuthContext = Depends(RequirePermission("trace.read")),
):
    """One trace as a span tree.

    Workspace-scoped in the WHERE clause, not filtered after the fact — a trace
    id is guessable enough that reading someone else's trace should be a
    404-by-construction rather than something a later `if` is responsible for.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT span_id, trace_id, parent_span_id, service, name, actor_id,
                   started_at, ended_at, duration_ms, status, error, attributes
            FROM spans
            WHERE trace_id = $1 AND workspace_id = $2
            ORDER BY started_at
            """,
            trace_id, auth.workspace_id,
        )
    if not rows:
        raise HTTPException(status_code=404, detail="Trace not found")

    spans = {
        str(r["span_id"]): {
            "span_id": str(r["span_id"]),
            "parent_span_id": str(r["parent_span_id"]) if r["parent_span_id"] else None,
            "service": r["service"],
            "name": r["name"],
            "started_at": r["started_at"],
            "duration_ms": r["duration_ms"],
            "status": r["status"],
            "error": r["error"],
            "attributes": _loads(r["attributes"]),
            "children": [],
        }
        for r in rows
    }

    roots = []
    for span in spans.values():
        parent = spans.get(span["parent_span_id"]) if span["parent_span_id"] else None
        if parent is not None:
            parent["children"].append(span)
        else:
            roots.append(span)

    # More than one root means the trace is broken into disconnected pieces --
    # exactly what a lost round-trip context looks like. Surfaced rather than
    # rendered as if it were fine.
    return {
        "trace_id": trace_id,
        "span_count": len(spans),
        "root_count": len(roots),
        "disconnected": len(roots) > 1,
        "roots": roots,
    }


@router.get("/metrics")
async def get_metrics(
    _: AuthContext = Depends(RequirePermission("trace.read")),
    hours: int = Query(24, ge=1, le=720),
):
    """Aggregated metrics over a window.

    count/avg/min/max only. `percentile_cont` would give nicer numbers and is
    Postgres-only; a p95 that exists on one backend and not the other is worse
    than an average that exists on both.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT metric, labels,
                   COUNT(*) AS samples,
                   AVG(value) AS avg_value,
                   MIN(value) AS min_value,
                   MAX(value) AS max_value
            FROM metric_samples
            WHERE recorded_at >= $1
            GROUP BY metric, labels
            ORDER BY metric
            """,
            since,
        )

    grouped: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        grouped.setdefault(r["metric"], []).append({
            "labels": _loads(r["labels"]),
            "samples": int(r["samples"] or 0),
            "avg": float(r["avg_value"]) if r["avg_value"] is not None else None,
            "min": float(r["min_value"]) if r["min_value"] is not None else None,
            "max": float(r["max_value"]) if r["max_value"] is not None else None,
        })
    return {"window_hours": hours, "metrics": grouped}


@router.get("/summary")
async def get_summary(
    auth: AuthContext = Depends(RequirePermission("trace.read")),
    hours: int = Query(24, ge=1, le=720),
):
    """Everything the dashboard needs above the fold, in one request.

    Deliberately one endpoint rather than five: the brief asks for one place to
    watch the system run, and a dashboard that fans out to five endpoints shows
    five different moments in time.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    pool = await get_pool()
    async with pool.acquire() as conn:
        span_stats = await conn.fetchrow(
            """
            SELECT COUNT(*) AS spans,
                   COUNT(DISTINCT trace_id) AS traces,
                   SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
            FROM spans
            WHERE workspace_id = $1 AND started_at >= $2
            """,
            auth.workspace_id, since,
        )
        slowest = await conn.fetch(
            """
            SELECT service, name, COUNT(*) AS calls, AVG(duration_ms) AS avg_ms,
                   MAX(duration_ms) AS max_ms
            FROM spans
            WHERE workspace_id = $1 AND started_at >= $2 AND duration_ms IS NOT NULL
            GROUP BY service, name
            ORDER BY AVG(duration_ms) DESC
            LIMIT 10
            """,
            auth.workspace_id, since,
        )
        retention = await conn.fetchrow(
            "SELECT MIN(started_at) AS oldest, COUNT(*) AS total FROM spans"
        )

    from app.services import circuit_breaker
    from app.services.tracing import RETENTION_DAYS

    try:
        breakers = await circuit_breaker.all_status()
    except Exception as e:  # noqa: BLE001
        log.warning("breaker_status_failed", error=str(e))
        breakers = []

    return {
        "window_hours": hours,
        "spans": int(span_stats["spans"] or 0),
        "traces": int(span_stats["traces"] or 0),
        "errors": int(span_stats["errors"] or 0),
        "slowest": [
            {
                "service": r["service"], "name": r["name"],
                "calls": int(r["calls"] or 0),
                "avg_ms": round(float(r["avg_ms"]), 1) if r["avg_ms"] is not None else None,
                "max_ms": round(float(r["max_ms"]), 1) if r["max_ms"] is not None else None,
            }
            for r in slowest
        ],
        "circuit_breakers": breakers,
        "retention": {
            "policy_days": RETENTION_DAYS,
            "oldest_span": retention["oldest"] if retention else None,
            "total_spans_all_workspaces": int(retention["total"] or 0) if retention else 0,
        },
    }


@router.post("/retention/sweep")
async def run_retention_sweep(
    _: AuthContext = Depends(RequirePermission("admin.write")),
    days: Optional[int] = Query(None, ge=1, le=3650),
):
    """Run the retention sweep now. Gated on admin.write, not trace.read —
    deleting data is not a read, however routine."""
    from app.services.tracing import sweep_retention

    return await sweep_retention(days)
