"""Memory & Knowledge — service facade.

Stage 4, service 3 of 4. This module IS the boundary described by
`docs/contracts/memory-knowledge.v1.yaml`: nothing outside this service imports
`memory_tool`, `agent_retrieval`, `document_retrieval`, `graph_repo`, `graph`
or `context_engine` directly.

Purging memory is the one deletion here that must NOT go through the contract's
compaction path. MK-2 forbids compaction becoming a route around provenance, and
a purge is a deletion, not a compaction. This deletes rows outright.

Provenance is now enforced by the database on both backends (V-11, migration
022), so `write_memory` requiring a `source` is no longer the only thing
standing between the system and a provenance-free entry. That matters because
Stage 5 is about to add a second writer.

Imports are lazy for the same reason the Model Gateway's are: `context_engine`
and `agent_retrieval` reach the Model Gateway, which reaches
`document_retrieval`, which is one of this service's own modules. Eager imports
here would close that loop at import time.
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


# ─── Memory, with provenance ─────────────────────────────────────────────────
async def write_memory(workspace_id: str, user_id: str, text: str,
                       source: str) -> None:
    """Contract: write_memory. `source` is required and has no default.

    There is deliberately no overload that omits it. Since migration 022 the
    database refuses an entry without a recognised source anyway -- but a
    signature that cannot express the mistake is better than one that can and
    is caught later.
    """
    from app.services.memory_tool import append_memory_entry

    return await append_memory_entry(workspace_id, user_id, text, source=source)


# Contract operation `read_memory` is deliberately NOT exposed here yet. The
# only reader today is the agent loop, which reaches memory through the
# `memory_read` ToolSpec rather than a direct call, so a facade function would
# be a wrapper with no caller. Adding it when Stage 5 needs it is additive;
# adding it now would be inventing an interface to look complete.


# ─── Retrieval and context ───────────────────────────────────────────────────
async def build_context(*args: Any, **kwargs: Any) -> Any:
    """Contract: retrieve. Search knowledge and the workspace graph."""
    from app.services.agent_retrieval import build_context as _b

    return await _b(*args, **kwargs)


def build_system_prompt(*args: Any, **kwargs: Any) -> Any:
    from app.services.agent_retrieval import build_system_prompt as _b

    return _b(*args, **kwargs)


async def workspace_summary(*args: Any, **kwargs: Any) -> Any:
    """Contract: build_planner_context."""
    from app.services.context_engine import get_workspace_summary

    return await get_workspace_summary(*args, **kwargs)


async def copilot_system(*args: Any, **kwargs: Any) -> Any:
    from app.services.context_engine import build_copilot_system

    return await build_copilot_system(*args, **kwargs)


async def project_copilot_system(*args: Any, **kwargs: Any) -> Any:
    from app.services.context_engine import build_project_copilot_system

    return await build_project_copilot_system(*args, **kwargs)


def generate_insights(*args: Any, **kwargs: Any) -> Any:
    from app.services.context_engine import generate_insights as _g

    return _g(*args, **kwargs)


# ─── The workspace graph ─────────────────────────────────────────────────────
async def get_connections(*args: Any, **kwargs: Any) -> Any:
    from app.services.graph import get_connections as _g

    return await _g(*args, **kwargs)


async def upsert_project_node(*args: Any, **kwargs: Any) -> Any:
    from app.services.graph import upsert_project_node as _u

    return await _u(*args, **kwargs)


async def upsert_idea_node(*args: Any, **kwargs: Any) -> Any:
    from app.services.graph import upsert_idea_node as _u

    return await _u(*args, **kwargs)


async def upsert_knowledge_node(*args: Any, **kwargs: Any) -> Any:
    from app.services.graph import upsert_knowledge_node as _u

    return await _u(*args, **kwargs)



# ─── Graph repository ────────────────────────────────────────────────────────
# Pass-throughs rather than a re-exported module: a facade that hands back
# `graph_repo` itself satisfies an import checker while narrowing nothing.
# Naming each operation is what makes the surface countable.
#
# The three oauth_connection functions are here under protest. They live in
# graph_repo because graph sync needed them, but oauth_connections is Identity
# & Access's table -- Memory & Knowledge is storing another service's
# credentials. See VIOLATIONS.md V-13.

async def upsert_venture(*a: Any, **k: Any) -> Any:
    from app.services import graph_repo
    return await graph_repo.upsert_venture(*a, **k)


async def find_venture_by_metadata(*a: Any, **k: Any) -> Any:
    from app.services import graph_repo
    return await graph_repo.find_venture_by_metadata(*a, **k)


async def upsert_doc(*a: Any, **k: Any) -> Any:
    from app.services import graph_repo
    return await graph_repo.upsert_doc(*a, **k)


async def upsert_event(*a: Any, **k: Any) -> Any:
    from app.services import graph_repo
    return await graph_repo.upsert_event(*a, **k)


async def upsert_person(*a: Any, **k: Any) -> Any:
    from app.services import graph_repo
    return await graph_repo.upsert_person(*a, **k)


async def upsert_graph_task(*a: Any, **k: Any) -> Any:
    from app.services import graph_repo
    return await graph_repo.upsert_graph_task(*a, **k)


async def add_edge(*a: Any, **k: Any) -> Any:
    from app.services import graph_repo
    return await graph_repo.add_edge(*a, **k)


async def get_oauth_connection(*a: Any, **k: Any) -> Any:
    """V-13: reads Identity & Access's table. Exposed to keep the move
    behaviour-preserving; belongs on the Identity contract."""
    from app.services import graph_repo
    return await graph_repo.get_oauth_connection(*a, **k)


async def upsert_oauth_connection(*a: Any, **k: Any) -> Any:
    """V-13: writes Identity & Access's table."""
    from app.services import graph_repo
    return await graph_repo.upsert_oauth_connection(*a, **k)


async def revoke_oauth_connection(*a: Any, **k: Any) -> Any:
    """V-13: writes Identity & Access's table."""
    from app.services import graph_repo
    return await graph_repo.revoke_oauth_connection(*a, **k)


# ─── Document retrieval ──────────────────────────────────────────────────────
# The Model Gateway reaches this for the DOCUMENT tier's long-context path.
def documents_configured() -> bool:
    from app.services import document_retrieval
    return document_retrieval.is_configured()


async def retrieve_document_context(*a: Any, **k: Any) -> Any:
    from app.services import document_retrieval
    return await document_retrieval.retrieve_context(*a, **k)


async def purge(workspace_id: str, user_id: Optional[str] = None,
                dry_run: bool = True) -> dict[str, Any]:
    """Contract: purge_workspace."""
    return await purge_tables(SERVICE, TABLES, workspace_id, user_id, dry_run)


async def export(workspace_id: str, user_id: Optional[str] = None) -> dict[str, Any]:
    """Contract: export_workspace."""
    return await export_tables(SERVICE, TABLES, workspace_id, user_id)
