"""
Model provider layer — Phase 1 of the agentic refactor.

Every model call in the app goes through this interface. Downstream code
does not know or care whether it's talking to Claude, GPT, Perplexity,
Gemini, or a self-hosted open model — the caller sees the same shape
(ModelProvider.complete(...) yielding ModelResponse chunks).

Why this exists:
    Today ai_router.py has four hand-written adapter functions
    (stream_strategic, stream_factual, stream_research, stream_document)
    each calling a different SDK. Swapping one for an open-model backend
    would require a rewrite in each caller. With this layer, swapping
    is a config change in MODEL_REGISTRY — same shape, different
    base_url + model.

Provider taxonomy:
    OpenAICompatibleProvider — handles anything on the OpenAI wire
        format: OpenAI itself, Perplexity, Gemini (via their
        OpenAI-compat endpoint), Together AI, Fireworks, and self-hosted
        vLLM. One class, N deployments.
    AnthropicProvider — Claude's SDK is not OpenAI-wire-compatible.

Interface (all providers implement this):
    async complete(messages, *, tools=None, stream=True, max_tokens,
                   timeout_s) -> AsyncIterator[ModelResponse]
        - Streams deltas as ModelResponse(content=<piece>).
        - Terminal yield has is_final=True and populated latency_ms
          (and tokens_in/out where the provider reports them).
        - On error, terminal yield has error=<str> and no content.

    async health_check() -> bool
        - Fast credential check. Does not hit the network in v1;
          admin dashboard in Phase 2 will add optional network probe.

Phase 1 scope: no tool-calling wiring yet — the `tools` argument is
accepted and ignored so the interface is stable when Phase 3 lands.
"""
from __future__ import annotations

import asyncio
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional
from urllib.parse import urlparse

import structlog
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

log = structlog.get_logger()


# ─── Outbound allowlist ──────────────────────────────────────────────────────
# Before any provider call fires, we check the target base_url's host
# against this allowlist. Cheap now; becomes critical once the Phase 3
# agent loop is making autonomous model calls without a human triggering
# each one.
#
# Set MODEL_PROVIDER_ALLOWLIST env to override (comma-separated). Default
# covers every host currently referenced by MODEL_REGISTRY plus the
# implicit "no base_url" cases (Anthropic SDK, plain OpenAI).

_DEFAULT_ALLOWLIST = (
    "api.anthropic.com",
    "api.openai.com",
    "api.perplexity.ai",
    "generativelanguage.googleapis.com",
    "api.together.xyz",
    "api.fireworks.ai",
)


def _allowlist() -> tuple[str, ...]:
    env = os.getenv("MODEL_PROVIDER_ALLOWLIST", "").strip()
    if not env:
        return _DEFAULT_ALLOWLIST
    return tuple(h.strip() for h in env.split(",") if h.strip())


def _host_of(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    try:
        return urlparse(url).hostname
    except Exception:
        return None


def _check_allowlisted(base_url: Optional[str], provider_name: str, model: str) -> Optional[str]:
    """Returns None if allowed; error string if not."""
    if base_url is None:
        # SDKs that connect to their own default endpoint (Anthropic, plain
        # OpenAI) — those defaults are api.anthropic.com and api.openai.com
        # respectively, both allowlisted by default.
        return None
    host = _host_of(base_url)
    if not host:
        return f"unparseable base_url: {base_url!r}"
    allowed = _allowlist()
    # Match exact host or any suffix (so `*.googleapis.com` covers
    # `generativelanguage.googleapis.com`, etc.)
    if any(host == a or host.endswith("." + a) for a in allowed):
        return None
    log.warning(
        "provider_call_blocked_by_allowlist",
        host=host, provider=provider_name, model=model,
    )
    return f"host {host!r} not in MODEL_PROVIDER_ALLOWLIST"


# ─── Model-specific quirks ───────────────────────────────────────────────────
# Some model IDs need special parameter handling. Centralized here so
# call sites don't need to remember which knob applies to which model.
#
# Keys are model-id prefixes (matched with startswith); values are dicts:
#   use_max_completion_tokens: bool  (OpenAI o1/o3 family requires this
#     instead of max_tokens)
#   no_temperature: bool             (some reasoning models reject
#     temperature)
#   no_streaming: bool               (rare; forces stream=False even if
#     caller asked for streaming)

_MODEL_QUIRKS: dict[str, dict[str, bool]] = {
    # OpenAI reasoning models — different token param, no temperature
    "o1":  {"use_max_completion_tokens": True, "no_temperature": True},
    "o3":  {"use_max_completion_tokens": True, "no_temperature": True},
    "o4":  {"use_max_completion_tokens": True, "no_temperature": True},
    # Perplexity sonar doesn't respect temperature the same way; harmless
    # to skip
    "sonar": {"no_temperature": True},
}


def _quirks_for(model: str) -> dict[str, bool]:
    out: dict[str, bool] = {}
    for prefix, q in _MODEL_QUIRKS.items():
        if model.startswith(prefix):
            out.update(q)
    return out


# ─── Response shape ──────────────────────────────────────────────────────────


@dataclass
class ModelResponse:
    """
    One yielded chunk from a provider. Streamed responses yield many of
    these; the final one has is_final=True and populated metadata.
    """
    content: str = ""
    model_used: str = ""
    provider: str = ""
    is_final: bool = False
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    latency_ms: Optional[float] = None
    tool_calls: Optional[list[dict[str, Any]]] = None
    error: Optional[str] = None


# ─── Provider ABC ────────────────────────────────────────────────────────────


class ModelProvider(ABC):
    """
    Abstract provider. Concrete implementations must fill:
        - provider_name  (e.g. "anthropic", "openai", "perplexity")
        - model          (the specific model id passed on the wire)
        - complete(...)  the streaming call
        - health_check() a fast readiness probe
    """

    provider_name: str = ""
    model: str = ""

    @abstractmethod
    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        tools: Optional[list[dict[str, Any]]] = None,
        stream: bool = True,
        max_tokens: int = 1200,
        timeout_s: float = 30.0,
    ) -> AsyncIterator[ModelResponse]:
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        ...


# ─── OpenAI-wire-compatible provider ─────────────────────────────────────────


class OpenAICompatibleProvider(ModelProvider):
    """
    Speaks OpenAI Chat Completions wire format. Works with:
        - OpenAI itself             (base_url=None)
        - Perplexity                (base_url=https://api.perplexity.ai)
        - Gemini via OpenAI compat  (base_url=…/generativelanguage.googleapis.com/v1beta/openai/)
        - Together AI               (base_url=https://api.together.xyz/v1)
        - Fireworks                 (base_url=https://api.fireworks.ai/inference/v1)
        - Self-hosted vLLM          (base_url=http://host:port/v1)
    """

    def __init__(
        self,
        *,
        api_key_env: str,
        model: str,
        provider_name: str,
        base_url: Optional[str] = None,
    ):
        self._api_key_env = api_key_env
        self.model = model
        self.provider_name = provider_name
        self._base_url = base_url
        self._client: Optional[AsyncOpenAI] = None

    def _client_or_none(self) -> Optional[AsyncOpenAI]:
        if self._client is not None:
            return self._client
        api_key = os.getenv(self._api_key_env)
        if not api_key:
            return None
        # base_url can also be resolved at call time for slots whose
        # config isn't finalized (e.g. the OSS classifier).
        base_url = self._base_url or None
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=30.0)
        return self._client

    def is_configured(self) -> bool:
        return bool(os.getenv(self._api_key_env))

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        tools: Optional[list[dict[str, Any]]] = None,
        stream: bool = True,
        max_tokens: int = 1200,
        timeout_s: float = 30.0,
    ) -> AsyncIterator[ModelResponse]:
        start = time.time()

        # Allowlist guard — reject calls to non-allowlisted hosts before
        # opening a connection.
        blocked = _check_allowlisted(self._base_url, self.provider_name, self.model)
        if blocked:
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error=blocked,
                latency_ms=(time.time() - start) * 1000,
            )
            return

        client = self._client_or_none()
        if client is None:
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error=f"{self._api_key_env} not set",
                latency_ms=(time.time() - start) * 1000,
            )
            return

        # Apply per-model quirks. Anything not in the quirks table
        # passes through with the standard OpenAI wire params.
        quirks = _quirks_for(self.model)
        token_kw = "max_completion_tokens" if quirks.get("use_max_completion_tokens") else "max_tokens"
        if quirks.get("no_streaming"):
            stream = False
        request_kwargs: dict[str, Any] = {
            "model": self.model,
            token_kw: max_tokens,
            "messages": messages,
            "timeout": timeout_s,
        }

        try:
            if stream:
                response = await client.chat.completions.create(
                    stream=True,
                    **request_kwargs,
                )
                async for chunk in response:
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta.content
                    if delta:
                        yield ModelResponse(
                            content=delta,
                            model_used=self.model,
                            provider=self.provider_name,
                        )
                yield ModelResponse(
                    model_used=self.model,
                    provider=self.provider_name,
                    is_final=True,
                    latency_ms=(time.time() - start) * 1000,
                )
            else:
                response = await client.chat.completions.create(
                    stream=False,
                    **request_kwargs,
                )
                text = response.choices[0].message.content or ""
                usage = getattr(response, "usage", None)
                yield ModelResponse(
                    content=text,
                    model_used=self.model,
                    provider=self.provider_name,
                    is_final=True,
                    tokens_in=getattr(usage, "prompt_tokens", None) if usage else None,
                    tokens_out=getattr(usage, "completion_tokens", None) if usage else None,
                    latency_ms=(time.time() - start) * 1000,
                )
        except asyncio.TimeoutError:
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error="timeout",
                latency_ms=(time.time() - start) * 1000,
            )
        except Exception as e:
            log.warning(
                "provider_error",
                provider=self.provider_name, model=self.model, error=str(e)[:200],
            )
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error=f"{type(e).__name__}: {str(e)[:200]}",
                latency_ms=(time.time() - start) * 1000,
            )

    async def health_check(self) -> bool:
        # Credential-only check for now; a real network probe is added
        # by the admin health endpoint in Phase 2.
        return self.is_configured() and bool(self.model)


# ─── Anthropic provider ──────────────────────────────────────────────────────


class AnthropicProvider(ModelProvider):
    """
    Claude via the native Anthropic SDK. Not OpenAI-wire-compatible
    (system prompt is a separate field, tool-call schema differs), so
    it gets its own class. Same ModelResponse output as everyone else.
    """

    def __init__(self, *, model: str, provider_name: str = "anthropic"):
        self.model = model
        self.provider_name = provider_name
        self._client: Optional[AsyncAnthropic] = None

    def _client_or_none(self) -> Optional[AsyncAnthropic]:
        if self._client is not None:
            return self._client
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            return None
        self._client = AsyncAnthropic(api_key=api_key, timeout=30.0)
        return self._client

    def is_configured(self) -> bool:
        return bool(os.getenv("ANTHROPIC_API_KEY"))

    @staticmethod
    def _split_system(messages: list[dict[str, str]]) -> tuple[str, list[dict[str, str]]]:
        """Anthropic takes `system` separately; extract it from messages."""
        system_parts: list[str] = []
        user_msgs: list[dict[str, str]] = []
        for m in messages:
            if m.get("role") == "system":
                system_parts.append(m.get("content", ""))
            else:
                user_msgs.append(m)
        return "\n\n".join(p for p in system_parts if p), user_msgs

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        tools: Optional[list[dict[str, Any]]] = None,
        stream: bool = True,
        max_tokens: int = 1200,
        timeout_s: float = 30.0,
    ) -> AsyncIterator[ModelResponse]:
        start = time.time()

        # Allowlist guard — Anthropic SDK defaults to api.anthropic.com,
        # which _check_allowlisted treats as allowed via base_url=None.
        blocked = _check_allowlisted(None, self.provider_name, self.model)
        if blocked:
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error=blocked,
                latency_ms=(time.time() - start) * 1000,
            )
            return

        client = self._client_or_none()
        if client is None:
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error="ANTHROPIC_API_KEY not set",
                latency_ms=(time.time() - start) * 1000,
            )
            return

        system, user_msgs = self._split_system(messages)

        try:
            if stream:
                async with client.messages.stream(
                    model=self.model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=user_msgs,
                ) as stream_ctx:
                    async for text in stream_ctx.text_stream:
                        if text:
                            yield ModelResponse(
                                content=text,
                                model_used=self.model,
                                provider=self.provider_name,
                            )
                yield ModelResponse(
                    model_used=self.model,
                    provider=self.provider_name,
                    is_final=True,
                    latency_ms=(time.time() - start) * 1000,
                )
            else:
                response = await client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=user_msgs,
                )
                text = response.content[0].text if response.content else ""
                usage = getattr(response, "usage", None)
                yield ModelResponse(
                    content=text,
                    model_used=self.model,
                    provider=self.provider_name,
                    is_final=True,
                    tokens_in=getattr(usage, "input_tokens", None) if usage else None,
                    tokens_out=getattr(usage, "output_tokens", None) if usage else None,
                    latency_ms=(time.time() - start) * 1000,
                )
        except asyncio.TimeoutError:
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error="timeout",
                latency_ms=(time.time() - start) * 1000,
            )
        except Exception as e:
            log.warning(
                "provider_error",
                provider=self.provider_name, model=self.model, error=str(e)[:200],
            )
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error=f"{type(e).__name__}: {str(e)[:200]}",
                latency_ms=(time.time() - start) * 1000,
            )

    async def health_check(self) -> bool:
        return self.is_configured() and bool(self.model)


# ─── Registry ────────────────────────────────────────────────────────────────
# Config, not code. Swap a provider by swapping the value; downstream
# callers see no change.
#
# CLASSIFIER_OSS is a placeholder slot for Phase 4 (open-model track).
# Set OSS_CLASSIFIER_BASE_URL / OSS_CLASSIFIER_API_KEY / OSS_CLASSIFIER_MODEL
# when the fine-tuned open model is provisioned. Until then it stays
# unconfigured; is_configured() returns False so the A/B mechanism in
# Phase 4 won't route to it.

# ─── Fallback registry (used until load_registry_from_db populates) ─────────
# Kept in code so the app boots and serves requests even before migration
# 014 has been applied, and so tests can run offline. Once the DB is
# populated and loaded, these values are overridden.

_FALLBACK_REGISTRY: dict[str, ModelProvider] = {
    "STRATEGIC": AnthropicProvider(model="claude-sonnet-4-6"),
    "FACTUAL": OpenAICompatibleProvider(
        api_key_env="OPENAI_API_KEY",
        model="gpt-4o-mini",
        provider_name="openai",
    ),
    "RESEARCH": OpenAICompatibleProvider(
        api_key_env="PERPLEXITY_API_KEY",
        model="sonar",
        provider_name="perplexity",
        base_url="https://api.perplexity.ai",
    ),
    "DOCUMENT": OpenAICompatibleProvider(
        api_key_env="GEMINI_API_KEY",
        model="gemini-1.5-flash",
        provider_name="gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
    ),
    "CLASSIFIER": AnthropicProvider(model="claude-haiku-4-5-20251001"),
    "CLASSIFIER_OSS": OpenAICompatibleProvider(
        api_key_env="OSS_CLASSIFIER_API_KEY",
        model=os.getenv("OSS_CLASSIFIER_MODEL", "unset-oss-model"),
        provider_name="oss",
        base_url=os.getenv("OSS_CLASSIFIER_BASE_URL"),
    ),
}

# Live registry — starts as the fallback, replaced in-place when
# load_registry_from_db() succeeds. Callers reference MODEL_REGISTRY[label]
# and always get the current value.
MODEL_REGISTRY: dict[str, ModelProvider] = dict(_FALLBACK_REGISTRY)

# Cached raw registry rows (for admin dashboard + measured_fitness writes).
_registry_rows: list[dict[str, Any]] = []
_registry_last_loaded: Optional[float] = None
_registry_lock = asyncio.Lock()


def _provider_from_row(row: dict[str, Any]) -> Optional[ModelProvider]:
    """Instantiate the correct ModelProvider subclass from a DB row."""
    try:
        cls = row.get("provider_class")
        model = row.get("model_name")
        api_key_env = row.get("api_key_env_var")
        base_url = row.get("base_url") or None
        provider_name = row.get("provider_name") or "unknown"
        if not model or not api_key_env:
            return None
        if cls == "anthropic":
            return AnthropicProvider(model=model, provider_name=provider_name)
        if cls == "openai_compatible":
            return OpenAICompatibleProvider(
                api_key_env=api_key_env,
                model=model,
                provider_name=provider_name,
                base_url=base_url,
            )
        log.warning("registry_unknown_provider_class", provider_class=cls, label=row.get("label"))
        return None
    except Exception as e:
        log.warning("registry_row_instantiation_failed", error=str(e)[:200], row=row)
        return None


async def load_registry_from_db() -> dict[str, ModelProvider]:
    """
    Load active rows from model_registry and rebuild MODEL_REGISTRY.

    Called on startup and on manual refresh. Silently falls back to the
    hard-coded _FALLBACK_REGISTRY if the DB table doesn't exist yet
    (migration 014 not applied) or if any error occurs — so the app is
    always callable even in a partial-deploy state.
    """
    global MODEL_REGISTRY, _registry_rows, _registry_last_loaded
    try:
        # Local import to avoid a circular dep at module load (postgres
        # depends on env, which loads before this module in dev).
        from app.db.postgres import get_pool
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT label, provider_name, provider_class, base_url, api_key_env_var,
                       model_name, capability_tags, priority, is_active,
                       measured_fitness, notes
                FROM model_registry
                WHERE is_active
                ORDER BY label, priority DESC
                """
            )
    except Exception as e:
        # Table missing, DB unavailable, etc. — keep the fallback registry.
        async with _registry_lock:
            if not _registry_rows:
                _registry_rows = []
        log.info(
            "model_registry_using_fallback",
            reason=f"{type(e).__name__}: {str(e)[:120]}",
        )
        return MODEL_REGISTRY

    new_registry: dict[str, ModelProvider] = {}
    raw_rows: list[dict[str, Any]] = []
    for r in rows:
        row = dict(r)
        raw_rows.append(row)
        # Prefer higher priority within a label; the unique-active index
        # already ensures only one active row per label, but ordering is
        # cheap insurance.
        if row["label"] in new_registry:
            continue
        provider = _provider_from_row(row)
        if provider is not None:
            new_registry[row["label"]] = provider

    if not new_registry:
        log.warning("model_registry_empty_after_load; keeping fallback")
        return MODEL_REGISTRY

    async with _registry_lock:
        MODEL_REGISTRY.clear()
        MODEL_REGISTRY.update(new_registry)
        _registry_rows = raw_rows
        _registry_last_loaded = time.time()

    log.info(
        "model_registry_loaded",
        rows=len(raw_rows), labels=sorted(new_registry.keys()),
    )
    return MODEL_REGISTRY


async def registry_rows() -> list[dict[str, Any]]:
    """Snapshot of the raw registry rows (for admin dashboard)."""
    if not _registry_rows:
        await load_registry_from_db()
    return list(_registry_rows)


async def registry_last_loaded_iso() -> Optional[str]:
    if _registry_last_loaded is None:
        return None
    import datetime as _dt
    return _dt.datetime.fromtimestamp(_registry_last_loaded, tz=_dt.timezone.utc).isoformat()


# ─── measured_fitness (P1.5.e) ───────────────────────────────────────────────
#
# Compute rolling-window aggregates from model_usage_log and write them
# back to model_registry.measured_fitness (JSONB). Routing decisions can
# reference this via load_registry_from_db() — vendor benchmarks stay
# out of the decision loop.
#
# Metrics per model_name (aggregated across query_types):
#     calls_7d        — call count in the last 7 days
#     avg_latency_ms  — mean per-call latency
#     p95_latency_ms  — 95th percentile latency
#     avg_cost_usd    — mean cost per call
#     avg_tps         — mean tokens/sec (throughput proxy)
#     efficiency      — mean tokens per USD
#     last_seen       — timestamp of most recent call
# Plus a nested per-query-type breakdown.

async def refresh_measured_fitness(window_days: int = 7) -> dict[str, Any]:
    """
    Recompute measured_fitness for every model_name that has activity in
    the last `window_days`, and write it to the model_registry row that
    matches (label happens to be the query_type in current usage, but we
    match by model_name — the label→model mapping is what the registry
    owns).

    Returns a summary of what was updated.
    """
    from app.db.postgres import get_pool
    import json as _json

    updates: dict[str, dict[str, Any]] = {}

    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    model,
                    query_type,
                    COUNT(*)                                        AS calls,
                    AVG(latency_ms)                                 AS avg_latency_ms,
                    percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
                    AVG(cost_usd)                                   AS avg_cost_usd,
                    AVG(tokens_per_second)                          AS avg_tps,
                    AVG(efficiency_score)                           AS avg_efficiency,
                    MAX(created_at)                                 AS last_seen
                FROM model_usage_log
                WHERE created_at > NOW() - ($1 || ' days')::interval
                GROUP BY model, query_type
                """,
                str(window_days),
            )

            # Aggregate rows grouped by model_name (union across query_types)
            per_model: dict[str, dict[str, Any]] = {}
            for r in rows:
                m = r["model"]
                per_type = per_model.setdefault(m, {
                    "window_days": window_days,
                    "calls_total": 0,
                    "by_query_type": {},
                    "avg_latency_ms": 0.0,
                    "p95_latency_ms": 0.0,
                    "avg_cost_usd": 0.0,
                    "avg_tps": 0.0,
                    "avg_efficiency": 0.0,
                    "last_seen": None,
                })
                per_type["calls_total"] += int(r["calls"])
                per_type["by_query_type"][r["query_type"]] = {
                    "calls": int(r["calls"]),
                    "avg_latency_ms": round(float(r["avg_latency_ms"] or 0), 1),
                    "p95_latency_ms": round(float(r["p95_latency_ms"] or 0), 1),
                    "avg_cost_usd": round(float(r["avg_cost_usd"] or 0), 6),
                    "avg_tps": round(float(r["avg_tps"] or 0), 1),
                    "avg_efficiency": round(float(r["avg_efficiency"] or 0), 0),
                }
                # Take last-seen and running max over per-type maxima
                if r["last_seen"] and (per_type["last_seen"] is None or r["last_seen"] > per_type["last_seen"]):
                    per_type["last_seen"] = r["last_seen"]

            # Compute unweighted means across query_types (simple; can be
            # weighted by call count in a follow-up if needed)
            for m, agg in per_model.items():
                by_qt = agg["by_query_type"]
                if not by_qt:
                    continue
                n = len(by_qt)
                agg["avg_latency_ms"] = round(sum(v["avg_latency_ms"] for v in by_qt.values()) / n, 1)
                agg["p95_latency_ms"] = round(max(v["p95_latency_ms"] for v in by_qt.values()), 1)
                agg["avg_cost_usd"] = round(sum(v["avg_cost_usd"] for v in by_qt.values()) / n, 6)
                agg["avg_tps"] = round(sum(v["avg_tps"] for v in by_qt.values()) / n, 1)
                agg["avg_efficiency"] = round(sum(v["avg_efficiency"] for v in by_qt.values()) / n, 0)
                if agg["last_seen"] is not None:
                    agg["last_seen"] = agg["last_seen"].isoformat()

            # Write back to model_registry.measured_fitness for matching rows
            for model_name, fitness in per_model.items():
                await conn.execute(
                    """
                    UPDATE model_registry
                    SET measured_fitness = $2::jsonb
                    WHERE model_name = $1
                    """,
                    model_name, _json.dumps(fitness),
                )
                updates[model_name] = {
                    "calls": fitness["calls_total"],
                    "p95_latency_ms": fitness["p95_latency_ms"],
                }
    except Exception as e:
        log.warning("refresh_measured_fitness_failed", error=str(e)[:200])
        return {"error": str(e)[:200], "updates": {}}

    # Refresh in-memory registry so new callers see updated fitness
    await load_registry_from_db()

    log.info(
        "measured_fitness_refreshed",
        models=len(updates), window_days=window_days,
    )
    return {"updates": updates, "window_days": window_days}


def get_provider(label: str) -> ModelProvider:
    """Fetch a provider by registry label. Raises KeyError on unknown label."""
    return MODEL_REGISTRY[label]


# ─── Resilience wrapper ──────────────────────────────────────────────────────
#
# One call site for "route this through the model layer with proper failure
# handling." Same-provider retry once on transient errors, then walk
# FALLBACK_ORDER for the next configured provider. Caller only sees the
# stream from the first provider that actually delivers content.

FALLBACK_ORDER = ["STRATEGIC", "FACTUAL", "RESEARCH", "DOCUMENT"]

# Substrings that suggest a transient error worth retrying same-provider once.
# Everything else (auth, quota, bad request) skips retry and falls through
# to the next provider immediately.
_TRANSIENT_MARKERS = (
    "timeout",
    "TimeoutError",
    "readtimeout",
    "connecttimeout",
    "connection reset",
    "ConnectionError",
    "ServerDisconnected",
    "503",
    "502",
    "504",
    "overloaded",
    "rate_limit",
    "RateLimitError",
    "Try again",
)


def _is_transient(error: str) -> bool:
    if not error:
        return False
    e = error.lower()
    return any(m.lower() in e for m in _TRANSIENT_MARKERS)


def _next_configured_label(exclude: set[str]) -> Optional[str]:
    """Pick the next label to try, skipping already-tried + unconfigured."""
    for candidate in FALLBACK_ORDER:
        if candidate in exclude:
            continue
        p = MODEL_REGISTRY.get(candidate)
        if p is None:
            continue
        is_conf = getattr(p, "is_configured", None)
        if callable(is_conf) and not is_conf():
            continue
        return candidate
    return None


async def call_with_resilience(
    label: str,
    messages: list[dict[str, str]],
    *,
    max_tokens: int = 1200,
    stream: bool = True,
    per_call_timeout_s: float = 45.0,
    on_status=None,   # Optional[Callable[[str], Awaitable[None]]]
) -> AsyncIterator[ModelResponse]:
    """
    Streaming call with same-provider transient retry + cross-provider
    fallback. Every yielded ModelResponse's `.model_used` and `.provider`
    reflect the provider that ACTUALLY delivered that chunk (so the
    caller can label the response correctly even if fallback fired).

    Contract with the caller:
        - Yields content chunks from the FIRST provider that streams
          any content (retry-then-fallback under the hood is invisible).
        - Terminal yield has is_final=True.
        - If every provider fails, terminal yield has .error set.

    on_status: optional async callback invoked when we retry or fall
        back, with a short human-readable message. Copilot forwards
        these into the SSE stream as `{"type": "status", ...}`.
    """
    if label not in MODEL_REGISTRY:
        yield ModelResponse(
            is_final=True,
            error=f"unknown label: {label}",
        )
        return

    tried: set[str] = set()
    current_label = label
    last_error: Optional[str] = None
    attempted_same_provider_retry = False

    async def _emit_status(text: str) -> None:
        if on_status is not None:
            try:
                await on_status(text)
            except Exception:
                pass

    while True:
        provider = MODEL_REGISTRY[current_label]
        tried.add(current_label)

        streamed_any = False
        this_error: Optional[str] = None
        stats = {"tokens_in": None, "tokens_out": None, "latency_ms": None}

        try:
            provider_iter = provider.complete(
                messages,
                stream=stream,
                max_tokens=max_tokens,
                timeout_s=per_call_timeout_s,
            )
            async for chunk in provider_iter:
                if chunk.error and not streamed_any:
                    this_error = chunk.error
                    break
                if chunk.content:
                    streamed_any = True
                    yield chunk
                if chunk.is_final:
                    stats["tokens_in"] = chunk.tokens_in
                    stats["tokens_out"] = chunk.tokens_out
                    stats["latency_ms"] = chunk.latency_ms
        except Exception as e:
            this_error = f"{type(e).__name__}: {str(e)[:200]}"

        if streamed_any:
            # Success — emit terminal with stats and stop.
            yield ModelResponse(
                model_used=provider.model,
                provider=provider.provider_name,
                is_final=True,
                tokens_in=stats["tokens_in"],
                tokens_out=stats["tokens_out"],
                latency_ms=stats["latency_ms"],
            )
            return

        last_error = this_error or last_error
        log.warning(
            "provider_failed",
            label=current_label,
            model=provider.model,
            error=(this_error or "no content streamed")[:200],
        )

        # Same-provider transient retry once
        if (
            not attempted_same_provider_retry
            and this_error
            and _is_transient(this_error)
        ):
            attempted_same_provider_retry = True
            await _emit_status(f"retrying {provider.provider_name}...")
            log.info("provider_retry_same", label=current_label, model=provider.model)
            continue

        # Fall through to next provider
        next_label = _next_configured_label(tried)
        if next_label is None:
            # Everyone failed. Terminal error.
            yield ModelResponse(
                model_used=provider.model,
                provider=provider.provider_name,
                is_final=True,
                error=last_error or "no working model available",
            )
            return

        next_provider = MODEL_REGISTRY[next_label]
        await _emit_status(f"switching to {next_provider.provider_name}...")
        log.info(
            "provider_fallback",
            from_label=current_label,
            from_model=provider.model,
            to_label=next_label,
            to_model=next_provider.model,
        )
        current_label = next_label
        attempted_same_provider_retry = False  # reset for the new provider


async def registry_health() -> dict[str, dict[str, Any]]:
    """Snapshot of every provider's readiness. Used by admin dashboard."""
    out: dict[str, dict[str, Any]] = {}
    for label, provider in MODEL_REGISTRY.items():
        try:
            ok = await provider.health_check()
        except Exception as e:
            ok = False
            note = str(e)[:120]
        else:
            note = None
        out[label] = {
            "provider": provider.provider_name,
            "model": provider.model,
            "healthy": ok,
            **({"note": note} if note else {}),
        }
    return out
