"""Agent Runtime — service facade.

Stage 4 has not moved this service yet (it is 4 of 4). This module exists early
because V-03 needs it: Identity & Access must be able to purge and export this
service's data without knowing its table names. The facade grows into the full
contract surface when Agent Runtime's turn comes.

No `facade:` is declared in ownership.yaml yet, so import enforcement stays off
for this service — its twenty-odd internal imports are still legal. Declaring it
early would fail CI for code that has not been asked to move.
"""
from __future__ import annotations

from typing import Any, Optional

from app.db.purge import TableSpec, export_tables, purge_tables

SERVICE = "agent_runtime"

# What this service holds that belongs to a workspace. Ordered so children go
# before parents -- pipeline_step_logs reaches its workspace only through
# pipeline_runs, so deleting the parent first would orphan it.
TABLES: list[TableSpec] = [
    TableSpec("pipeline_step_logs",
              via="run_id IN (SELECT id FROM pipeline_runs WHERE workspace_id = $1)",
              user_purgeable=False),
    TableSpec("pipeline_runs", user_purgeable=False),
    TableSpec("agent_runs", user_col="user_id"),
    TableSpec("copilot_messages", user_col="user_id"),
    TableSpec("forge_outputs", user_col="user_id"),
    TableSpec("command_history", user_purgeable=False),
]


async def purge(workspace_id: str, user_id: Optional[str] = None,
                dry_run: bool = True) -> dict[str, Any]:
    """Contract: purge_workspace."""
    return await purge_tables(SERVICE, TABLES, workspace_id, user_id, dry_run)


async def export(workspace_id: str, user_id: Optional[str] = None) -> dict[str, Any]:
    """Contract: export_workspace."""
    return await export_tables(SERVICE, TABLES, workspace_id, user_id)
