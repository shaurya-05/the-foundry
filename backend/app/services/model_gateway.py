"""Model Gateway — the single entry point to every model in the system.

Stage 4, service 1 of 4. This module IS the boundary described by
`docs/contracts/model-gateway.v1.yaml`. Nothing outside this service imports
`ai_router`, `model_provider`, `claude` or `embeddings` directly any more;
`backend/scripts/check_service_imports.py` enforces that in CI.

Why a facade rather than moving files around: the contract is what other
services depend on, and a contract is a statement about messages. Relocating
`ai_router.py` into a package would churn every import for no change in
coupling. Putting one named surface in front of it changes the coupling without
touching the verified routing logic underneath — which is the whole point of a
staged refactor rather than a rewrite.

What this deliberately does NOT do
----------------------------------
`stream_claude` and `complete_claude` are re-exported here as
`stream_direct` / `complete_direct`, still going straight to Anthropic without
tier routing. Eight modules call them today. Routing those calls through
`route_query` would change which model answers — a behaviour change smuggled
inside a refactor, and the one thing a move like this must not do. They are
exposed, marked deprecated, and recorded as MG-GAP-2 so the bypass is visible
and countable rather than invisible and permanent.
"""
from __future__ import annotations

from typing import Any, AsyncIterator, Optional

import structlog

log = structlog.get_logger()

# ─── Contract operations ─────────────────────────────────────────────────────
# EVERY import of this service's internals is lazy, inside the function that
# needs it. That is not style: the first version imported ai_router and
# embeddings at module level and the app would not boot. ai_router imports
# document_retrieval, which now imports this facade for embeddings -- a cycle
# that only exists because the facade is the new front door.
#
# A facade that pulls in its whole service graph at import time re-creates the
# coupling it was built to remove. Lazy imports keep the front door thin.


async def route(*args: Any, **kwargs: Any) -> AsyncIterator[Any]:
    """Contract: route_query. Route by TIER and stream the answer.

    Callers name a tier, never a model (MG-3). The stream yields text deltas and
    may yield a final ("model_used", <model>) correction if a failover happened
    mid-answer, so the reported model is the one that actually produced the
    tokens (MG-2).
    """
    from app.services.ai_router import route_query

    async for chunk in route_query(*args, **kwargs):
        yield chunk


async def classify(query: str) -> str:
    """Contract: classify_query."""
    from app.services.ai_router import classify_query

    return await classify_query(query)


async def council(system: str, message: str) -> list[dict]:
    """Multi-perspective answer. Part of the routing surface, not a provider call."""
    from app.services.ai_router import get_council_perspectives

    return await get_council_perspectives(system, message)


def estimate_tokens(text: str) -> int:
    """Token estimation. Exposed because callers budget context against it."""
    from app.services.ai_router import estimate_tokens as _est

    return _est(text)


async def registry_health() -> dict[str, dict[str, Any]]:
    """Contract: registry_health. Per-tier health, warmth and VRAM residency."""
    from app.services.model_provider import registry_health as _h

    return await _h()


async def registry_rows() -> list[dict[str, Any]]:
    """Raw registry rows, for the admin and observability surfaces."""
    from app.services.model_provider import registry_rows as _r

    return await _r()


async def registry_last_loaded_iso() -> Optional[str]:
    from app.services.model_provider import registry_last_loaded_iso as _t

    return await _t()


async def load_registry() -> dict[str, Any]:
    """Load the registry from the database. Called once at startup."""
    from app.services.model_provider import load_registry_from_db

    return await load_registry_from_db()


async def refresh_measured_fitness(window_days: int = 7) -> dict[str, Any]:
    """Contract: refresh_measured_fitness."""
    from app.services.model_provider import refresh_measured_fitness as _f

    return await _f(window_days=window_days)


def tier_labels() -> list[str]:
    """The tiers the registry currently knows about.

    Replaces direct reads of MODEL_REGISTRY from three modules outside this
    service. They wanted the label set, not the provider objects — handing back
    a list of strings keeps the provider internals private.
    """
    from app.services.model_provider import MODEL_REGISTRY

    return sorted(MODEL_REGISTRY.keys())


def tier_configured(label: str) -> bool:
    """Whether a tier has a configured provider."""
    from app.services.model_provider import MODEL_REGISTRY

    return label in MODEL_REGISTRY


def get_provider(label: str) -> Any:
    """DEPRECATED. Hand back the provider object for a tier.

    Three modules (`agent_loop`, `h3ro_style`, `watch_service`) currently take a
    provider out of the registry and call it themselves. That leaks this
    service's internals through the boundary: the caller holds a provider, so it
    also holds the fallback behaviour, the quirks table and the resilience
    wrapper that `route()` would otherwise apply on its behalf.

    Exposed here anyway, because the alternative is rewriting three call sites to
    use `route()` inside a move — and `route()` classifies and falls back
    differently, so that is a behaviour change wearing a refactor's clothes.
    Recorded as MG-GAP-3; those three call sites are the next thing to fix, and
    they are now countable because this is the only door.
    """
    from app.services.model_provider import MODEL_REGISTRY

    return MODEL_REGISTRY.get(label)


async def breaker_status() -> list[dict[str, Any]]:
    """Contract: breaker_status.

    Delegates to the shared resilience substrate rather than owning it. The
    circuit breaker is generic infrastructure — github_sync, google_drive and
    notion_sync use it for their own connectors, which are nothing to do with
    models. Stage 3 assigned it to this service; the move showed that was wrong.
    See VIOLATIONS.md V-09.
    """
    from app.services import circuit_breaker

    return await circuit_breaker.all_status()


async def usage_stats() -> list[dict[str, Any]]:
    """Contract: usage_stats. Cost and efficiency, grouped by model and tier.

    This query lived in admin.py, which meant an operator surface was reading
    this service's table directly. It was invisible to the boundary checker only
    because model_usage_log was in no migration -- fixing V-08 made the
    violation appear. A bug hiding a boundary violation is a good argument for
    checking both.
    """
    from app.db.postgres import get_pool

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT model, query_type,
                   COUNT(*) AS calls,
                   SUM(input_tokens) AS total_input_tokens,
                   SUM(output_tokens) AS total_output_tokens,
                   SUM(cost_usd) AS total_cost_usd,
                   AVG(latency_ms) AS avg_latency_ms,
                   AVG(efficiency_score) AS avg_efficiency,
                   AVG(tokens_per_second) AS avg_tokens_per_second
            FROM model_usage_log
            GROUP BY model, query_type
            ORDER BY total_cost_usd DESC
            """
        )
    return [
        {
            "model": r["model"],
            "query_type": r["query_type"],
            "calls": r["calls"],
            "total_input_tokens": r["total_input_tokens"],
            "total_output_tokens": r["total_output_tokens"],
            "total_cost_usd": round(float(r["total_cost_usd"] or 0), 4),
            "avg_latency_ms": round(float(r["avg_latency_ms"] or 0), 1),
            "avg_efficiency": round(float(r["avg_efficiency"] or 0), 0),
            "avg_tokens_per_second": round(float(r["avg_tokens_per_second"] or 0), 1),
        }
        for r in rows
    ]


# ─── Embeddings ──────────────────────────────────────────────────────────────
async def embed_text(text: str) -> list[float]:
    """Contract: embed. One text to one vector."""
    from app.services.embeddings import embed_text as _e

    return await _e(text)


async def embed_batch(texts: list[str]) -> list[list[float]]:
    """Contract: embed_batch."""
    from app.services.embeddings import embed_batch as _e

    return await _e(texts)


# ─── Deprecated: direct provider calls that bypass tier routing ──────────────
async def stream_direct(*args: Any, **kwargs: Any) -> AsyncIterator[str]:
    """DEPRECATED. Streams straight to Anthropic, bypassing tier routing.

    Violates MG-3 by naming a provider rather than a tier. Kept so that moving
    this service behind its contract does not change which model answers — that
    would be a behaviour change hidden inside a refactor. Eight modules call
    this; each one is a routing decision made in the wrong place. MG-GAP-2.
    """
    from app.services.claude import stream_claude

    async for chunk in stream_claude(*args, **kwargs):
        yield chunk


async def complete_direct(*args: Any, **kwargs: Any) -> str:
    """DEPRECATED. Completes straight to Anthropic, bypassing tier routing.

    See stream_direct. MG-GAP-2.
    """
    from app.services.claude import complete_claude

    return await complete_claude(*args, **kwargs)


__all__ = [
    "route",
    "classify",
    "council",
    "estimate_tokens",
    "registry_health",
    "registry_rows",
    "registry_last_loaded_iso",
    "load_registry",
    "refresh_measured_fitness",
    "tier_labels",
    "tier_configured",
    "breaker_status",
    "usage_stats",
    "embed_text",
    "embed_batch",
    "stream_direct",
    "complete_direct",
]
