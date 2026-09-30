"""Memory & Knowledge — service facade.

Exists early for the same reason as agent_runtime's: V-03. Stage 4 moves this
service third.

Note that purging memory is the one deletion in this system that must NOT go
through the memory contract's own compaction path -- MK-2 forbids compaction
becoming a route around provenance, and a purge is a deletion, not a compaction.
This deletes rows outright.
"""
from __future__ import annotations

from typing import Any, Optional

from app.db.purge import TableSpec, export_tables, purge_tables

SERVICE = "memory_knowledge"

TABLES: list[TableSpec] = [
    TableSpec("agent_memory", user_col="user_id"),
    TableSpec("knowledge_items", user_col="user_id"),
    TableSpec("edges", user_purgeable=False),
    TableSpec("docs", user_purgeable=False),
    TableSpec("events", user_purgeable=False),
    TableSpec("graph_tasks", user_purgeable=False),
    TableSpec("persons", user_col="user_id"),
]


async def purge(workspace_id: str, user_id: Optional[str] = None,
                dry_run: bool = True) -> dict[str, Any]:
    """Contract: purge_workspace."""
    return await purge_tables(SERVICE, TABLES, workspace_id, user_id, dry_run)


async def export(workspace_id: str, user_id: Optional[str] = None) -> dict[str, Any]:
    """Contract: export_workspace."""
    return await export_tables(SERVICE, TABLES, workspace_id, user_id)
