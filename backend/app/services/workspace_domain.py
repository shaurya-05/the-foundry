"""Workspace Domain — service facade.

The sixth context, ratified 2026-09-29. Exists early for V-03; Stage 4 has not
moved this service yet.

`webhook_events` is deliberately absent: it records raw provider deliveries and
carries no workspace scoping at all, so there is no correct way to purge it per
workspace. Recorded rather than silently skipped -- see VIOLATIONS.md V-10.
"""
from __future__ import annotations

from typing import Any, Optional

from app.db.purge import TableSpec, export_tables, purge_tables

SERVICE = "workspace_domain"

TABLES: list[TableSpec] = [
    TableSpec("tasks", user_col="user_id"),
    TableSpec("projects", user_col="user_id"),
    TableSpec("ideas", user_col="user_id"),
    TableSpec("ventures", user_purgeable=False),
    TableSpec("activity_events", user_col="user_id"),
    TableSpec("notifications", user_col="user_id"),
    TableSpec("blueprint_ops", user_col="user_id"),
    TableSpec("blueprint_canvas", user_purgeable=False),
    TableSpec("watches", user_col="user_id"),
    TableSpec("cloud_sync_link", user_purgeable=False),
    TableSpec("sync_jobs", user_purgeable=False),
    TableSpec("revenue", user_purgeable=False),
]


async def purge(workspace_id: str, user_id: Optional[str] = None,
                dry_run: bool = True) -> dict[str, Any]:
    """Contract: purge_workspace."""
    return await purge_tables(SERVICE, TABLES, workspace_id, user_id, dry_run)


async def export(workspace_id: str, user_id: Optional[str] = None) -> dict[str, Any]:
    """Contract: export_workspace."""
    return await export_tables(SERVICE, TABLES, workspace_id, user_id)
