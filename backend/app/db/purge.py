"""Shared mechanism for workspace/user purge and export.

Each service declares WHICH of its tables hold workspace data and how they are
scoped; this module does the deleting. The spec is the service's knowledge, the
mechanism is not — so Identity & Access can orchestrate a deletion without
knowing a single table name belonging to anyone else (V-03).

**Nothing here swallows an error.** The code this replaces wrapped every delete
in `try/except: pass`, with the comment "tables that may not exist in all
environments". The effect was a GDPR deletion path that reported success while
deleting nothing, on any database where a table was missing — which, after V-08,
we know was not hypothetical. A purge that cannot complete must fail loudly:
a partial deletion silently reported as complete is the worst of the three
possible outcomes.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import structlog

from app.db.postgres import get_pool

log = structlog.get_logger()


@dataclass(frozen=True)
class TableSpec:
    """How one table is scoped to a workspace and, optionally, to a user."""

    name: str
    workspace_col: Optional[str] = "workspace_id"
    user_col: Optional[str] = None
    # For tables reachable only through a parent (pipeline_step_logs -> run_id).
    via: Optional[str] = None
    user_purgeable: bool = True

    def delete_sql(self, *, by_user: bool) -> tuple[str, int]:
        if self.via:
            return f"DELETE FROM {self.name} WHERE {self.via}", 1
        if by_user and self.user_col:
            return (
                f"DELETE FROM {self.name} WHERE {self.workspace_col} = $1 "
                f"AND {self.user_col} = $2",
                2,
            )
        return f"DELETE FROM {self.name} WHERE {self.workspace_col} = $1", 1

    def count_sql(self, *, by_user: bool) -> tuple[str, int]:
        sql, n = self.delete_sql(by_user=by_user)
        return sql.replace("DELETE FROM", "SELECT COUNT(*) FROM", 1), n


async def purge_tables(
    service: str,
    specs: list[TableSpec],
    workspace_id: str,
    user_id: Optional[str] = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Delete this service's rows for a workspace, or for one user within it.

    When `user_id` is given, tables with no user column are left alone: those
    rows belong to the workspace, not to the departing member. Deleting them
    because one person left would destroy a colleague's data.
    """
    by_user = user_id is not None
    pool = await get_pool()
    cleared: dict[str, int] = {}
    total = 0

    async with pool.acquire() as conn:
        for spec in specs:
            if by_user and not spec.user_purgeable:
                continue
            if by_user and not spec.user_col and not spec.via:
                continue

            count_sql, argc = spec.count_sql(by_user=by_user)
            args = (workspace_id, user_id)[:argc] if argc == 2 else (workspace_id,)
            n = await conn.fetchval(count_sql, *args)
            n = int(n or 0)
            if n == 0:
                continue
            cleared[spec.name] = n
            total += n
            if not dry_run:
                del_sql, _ = spec.delete_sql(by_user=by_user)
                await conn.execute(del_sql, *args)

    log.info(
        "purge_completed" if not dry_run else "purge_planned",
        service=service, workspace_id=workspace_id, user_id=user_id,
        dry_run=dry_run, tables=len(cleared), rows=total,
    )
    return {
        "service": service,
        "dry_run": dry_run,
        "tables_cleared": sorted(cleared),
        "rows_per_table": cleared,
        "rows_deleted": total,
    }


async def export_tables(
    service: str,
    specs: list[TableSpec],
    workspace_id: str,
    user_id: Optional[str] = None,
    row_cap: int = 10_000,
) -> dict[str, Any]:
    """Everything this service holds for a workspace, for data export."""
    by_user = user_id is not None
    pool = await get_pool()
    out: dict[str, list[dict[str, Any]]] = {}

    async with pool.acquire() as conn:
        for spec in specs:
            if spec.via:
                continue  # exported with its parent
            if by_user and spec.user_col:
                sql = (f"SELECT * FROM {spec.name} WHERE {spec.workspace_col} = $1 "
                       f"AND {spec.user_col} = $2 LIMIT {row_cap}")
                rows = await conn.fetch(sql, workspace_id, user_id)
            else:
                sql = f"SELECT * FROM {spec.name} WHERE {spec.workspace_col} = $1 LIMIT {row_cap}"
                rows = await conn.fetch(sql, workspace_id)
            if rows:
                out[spec.name] = [dict(r) for r in rows]

    return {"service": service, "tables": out}
