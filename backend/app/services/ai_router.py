"""
AI Router — classifier + label→provider dispatch, on top of MODEL_REGISTRY.

Phase 1 refactor: the four hand-written stream_* adapters are gone. All
model calls go through model_provider.MODEL_REGISTRY[label].complete(...).
Swapping GPT-4o Mini for a self-hosted Llama is now a MODEL_REGISTRY
edit — this file is untouched.

Model selection labels (kept identical for compatibility):
    STRATEGIC  — Claude Sonnet 4          (multi-step reasoning, ambiguity)
    FACTUAL    — GPT-4o Mini              (structured facts, definitions)
    RESEARCH   — Perplexity Sonar         (live web index)
    DOCUMENT   — Gemini 1.5 Flash         (long-context)
    CLASSIFIER — Claude Haiku 4.5         (routes queries into the four)
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import AsyncIterator, Optional

import structlog

from app.services.model_provider import MODEL_REGISTRY, ModelResponse

log = structlog.get_logger()

# ─── Cost table (per million tokens) — verified June 2026 ────────────────────
MODEL_COSTS = {
    "claude-sonnet-4":              {"input": 3.00,  "output": 15.00, "request_fee": 0.0},
    "claude-sonnet-4-6":            {"input": 3.00,  "output": 15.00, "request_fee": 0.0},
    "claude-sonnet-4-20250514":     {"input": 3.00,  "output": 15.00, "request_fee": 0.0},
    "claude-haiku-4-5":             {"input": 1.00,  "output": 5.00,  "request_fee": 0.0},
    "claude-haiku-4-5-20251001":    {"input": 1.00,  "output": 5.00,  "request_fee": 0.0},
    "gpt-4o-mini":                  {"input": 0.15,  "output": 0.60,  "request_fee": 0.0},
    "sonar":                        {"input": 1.00,  "output": 1.00,  "request_fee": 0.005},
    "perplexity-sonar":             {"input": 1.00,  "output": 1.00,  "request_fee": 0.005},
    "gemini-1.5-flash":             {"input": 0.075, "output": 0.30,  "request_fee": 0.0},
    "gemini-2.5-flash":             {"input": 0.30,  "output": 2.50,  "request_fee": 0.0},
}


def estimate_tokens(text: str) -> int:
    """Rough token estimate — ~4 chars per token."""
    return max(1, len(text) // 4)


def log_model_usage(
    model: str,
    prompt: str,
    response: str,
    latency_ms: float,
    query_type: str = "unknown",
    tokens_in: Optional[int] = None,
    tokens_out: Optional[int] = None,
):
    """
    Emit a structured log line and best-effort DB write to model_usage_log.

    tokens_in/tokens_out come from the provider when it reports them
    (Anthropic + OpenAI usage blocks); we fall back to char-based
    estimation otherwise so the historical time-series doesn't break.
    """
    if tokens_in is None:
        tokens_in = estimate_tokens(prompt)
    if tokens_out is None:
        tokens_out = estimate_tokens(response)

    costs = MODEL_COSTS.get(model, {"input": 0, "output": 0, "request_fee": 0.0})
    cost_usd = (tokens_in * costs["input"] + tokens_out * costs["output"]) / 1_000_000 + costs.get("request_fee", 0.0)
    efficiency = tokens_out / max(cost_usd, 0.000001)
    tps = tokens_out / max(latency_ms / 1000, 0.001)

    stats = {
        "model": model,
        "query_type": query_type,
        "input_tokens": tokens_in,
        "output_tokens": tokens_out,
        "total_tokens": tokens_in + tokens_out,
        "cost_usd": round(cost_usd, 6),
        "latency_ms": round(latency_ms, 1),
        "efficiency_score": round(efficiency, 0),
        "tokens_per_second": round(tps, 1),
    }
    log.info("model_usage", **stats)

    try:
        from app.db.postgres import get_pool as _get_pool

        async def _write():
            try:
                pool = await _get_pool()
                async with pool.acquire() as conn:
                    await conn.execute(
                        """INSERT INTO model_usage_log
                           (model, query_type, input_tokens, output_tokens, cost_usd,
                            latency_ms, efficiency_score, tokens_per_second)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
                        model, query_type, tokens_in, tokens_out,
                        round(cost_usd, 6), round(latency_ms, 1),
                        int(round(efficiency, 0)), round(tps, 1),
                    )
            except Exception:
                pass

        asyncio.ensure_future(_write())
    except Exception:
        pass

    return stats


# ─── Classifier + format addendum ────────────────────────────────────────────

CLASSIFIER_PROMPT = """You are a query router for an AI system. Classify this founder query into exactly one category. Reply with only the label, nothing else.

STRATEGIC — Use when: multi-step reasoning required, business model critique, investor/fundraising prep, competitive positioning, go-to-market strategy, product decisions with tradeoffs, ambiguous situations requiring judgment. Best model: Claude Sonnet 4 (MMLU 88.7%, strongest on nuanced reasoning per Anthropic 2025 evals).

FACTUAL — Use when: single-fact lookup, definition, quick summary of known concept, template fill, formatting request, yes/no with brief explanation, math calculation. Best model: GPT-4o Mini (82% MMLU, 3x faster, optimal for structured retrieval per OpenAI 2024 evals).

RESEARCH — Use when: market sizing, competitor landscape, industry trends, current events, pricing data, "what is X currently doing", anything requiring information newer than training data. Best model: Perplexity Sonar (live web index, best recall on time-sensitive queries per Perplexity 2025).

DOCUMENT — Use when: analyzing uploaded documents, reviewing pitch decks, summarizing long reports, cross-referencing multiple sources, tasks where full document context is needed. Best model: Gemini 1.5 Flash (1M token window, strongest long-context performance per Google 2024 evals).

Default to STRATEGIC if ambiguous — never route ambiguous queries to cheaper models.

Query: {query}

Label:"""


FORMAT_ADDENDUM = """

RESPONSE FORMAT RULES (follow exactly):
- Lead with the most important insight in plain prose — one to three sentences. Never start with a bullet or header.
- Use structure (bullets, numbered lists, headers) ONLY when the content is genuinely enumerable or sequential. Do not bullet things that read naturally as prose.
- Never use filler phrases: "Great question", "Certainly", "Of course", "I'd be happy to", "As an AI". Start immediately with substance.
- Bullets must be complete thoughts, not fragments. Each bullet should be 1-2 sentences minimum.
- Use **bold** only for terms that genuinely need emphasis — not for decoration. Maximum 3 bold phrases per response.
- For strategic questions: lead with a clear position, then support it. Do not hedge endlessly.
- For factual questions: answer directly in the first sentence, then provide context if needed.
- Match length to complexity. A simple question deserves a short answer. A complex strategic question deserves depth. Never pad.
- If you cite data or statistics, include the source inline. Do not make up numbers.
- End responses cleanly. No "I hope this helps" or "Let me know if you need anything else"."""


VALID_LABELS = ("STRATEGIC", "FACTUAL", "RESEARCH", "DOCUMENT")


async def classify_query(query: str) -> str:
    """
    Run the classifier and return one of VALID_LABELS. Falls back to
    STRATEGIC on any error — never routes ambiguous queries to cheap
    models.
    """
    provider = MODEL_REGISTRY["CLASSIFIER"]
    messages = [{"role": "user", "content": CLASSIFIER_PROMPT.format(query=query)}]

    full = []
    async for chunk in provider.complete(messages, stream=False, max_tokens=10, timeout_s=15.0):
        if chunk.error:
            log.warning("classifier_error", error=chunk.error)
            return "STRATEGIC"
        if chunk.content:
            full.append(chunk.content)

    label = "".join(full).strip().upper()
    return label if label in VALID_LABELS else "STRATEGIC"


def _inject_format(system: str) -> str:
    return system + FORMAT_ADDENDUM


# ─── Council ──────────────────────────────────────────────────────────────────
# Runs two secondary models in parallel and returns their perspectives.
# The Phase 2 fix (make this non-blocking on the SSE stream) lands in
# copilot.py — this function itself stays the same shape.

COUNCIL_LABELS = ["STRATEGIC", "FACTUAL"]


async def _collect_response(label: str, system: str, message: str) -> dict:
    provider = MODEL_REGISTRY[label]
    messages = [
        {"role": "system", "content": _inject_format(system)},
        {"role": "user", "content": message},
    ]
    parts = []
    err = None
    async for chunk in provider.complete(messages, stream=True, max_tokens=600):
        if chunk.error:
            err = chunk.error
            break
        if chunk.content:
            parts.append(chunk.content)
    if err:
        return {"model": provider.model, "response": f"[{provider.provider_name} unavailable: {err[:80]}]"}
    return {"model": provider.model, "response": "".join(parts)}


async def get_council_perspectives(system: str, message: str) -> list[dict]:
    """Run 2 secondary models in parallel and return their perspectives."""
    results = await asyncio.gather(
        *(_collect_response(label, system, message) for label in COUNCIL_LABELS),
        return_exceptions=True,
    )
    return [r for r in results if isinstance(r, dict)]


# ─── Main router ──────────────────────────────────────────────────────────────


def _label_from_override(model_override: Optional[str]) -> Optional[str]:
    """Reverse-lookup a label from a model id passed by the frontend."""
    if not model_override:
        return None
    for label in VALID_LABELS:
        if MODEL_REGISTRY[label].model == model_override or MODEL_REGISTRY[label].provider_name == model_override:
            return label
    # Convenience aliases from the old ROUTE_MAP entries
    aliases = {
        "claude-sonnet-4": "STRATEGIC",
        "gpt-4o-mini": "FACTUAL",
        "perplexity-sonar": "RESEARCH",
        "sonar": "RESEARCH",
        "gemini-1.5-flash": "DOCUMENT",
    }
    return aliases.get(model_override)


FALLBACK_ORDER = ["STRATEGIC", "FACTUAL", "RESEARCH", "DOCUMENT"]


def _next_fallback_label(exclude: set[str]) -> Optional[str]:
    """Pick the next label to try, skipping ones already tried in this request."""
    for candidate in FALLBACK_ORDER:
        if candidate in exclude:
            continue
        # Only fall back to a provider whose credentials look sane.
        p = MODEL_REGISTRY[candidate]
        is_conf = getattr(p, "is_configured", None)
        if callable(is_conf) and not is_conf():
            continue
        return candidate
    return None


async def route_query(
    system: str,
    message: str,
    max_tokens: int = 1200,
    model_override: Optional[str] = None,
) -> AsyncIterator[str]:
    """
    Classify and stream from the best model.

    First yield is always the model id string (for copilot.py to emit
    as a `model_used` SSE event). Subsequent yields are text deltas.
    Preserves the exact contract of the pre-refactor route_query.

    Fallback policy: if a provider emits an error chunk before any text
    streams, we try the next working provider in FALLBACK_ORDER — never
    retrying a provider that already failed this request. If every
    fallback fails, yield a plain-text error message so the UI shows
    something instead of going silent.
    """
    label = _label_from_override(model_override) or await classify_query(message)
    if label not in VALID_LABELS:
        label = "STRATEGIC"

    provider = MODEL_REGISTRY[label]
    model_id = provider.model
    yield model_id

    messages = [
        {"role": "system", "content": _inject_format(system)},
        {"role": "user", "content": message},
    ]

    start = time.time()
    full_response: list[str] = []
    provider_tokens_in: Optional[int] = None
    provider_tokens_out: Optional[int] = None
    provider_latency: Optional[float] = None
    tried: set[str] = {label}
    last_error: Optional[str] = None

    async def _drain(prov, active_label: str):
        """Consume one provider's stream. Yields deltas, returns (streamed_any, error, stats)."""
        streamed_any = False
        error: Optional[str] = None
        stats = {"tokens_in": None, "tokens_out": None, "latency_ms": None}
        async for chunk in prov.complete(
            messages, stream=True, max_tokens=max_tokens, timeout_s=45.0,
        ):
            if chunk.error and not streamed_any:
                error = chunk.error
                log.warning(
                    "route_query_provider_error",
                    label=active_label, model=prov.model, error=error,
                )
                break
            if chunk.content:
                streamed_any = True
                full_response.append(chunk.content)
                yield ("text", chunk.content)
            if chunk.is_final:
                stats["tokens_in"] = chunk.tokens_in
                stats["tokens_out"] = chunk.tokens_out
                stats["latency_ms"] = chunk.latency_ms
        yield ("done", (streamed_any, error, stats))

    active_label = label
    active_provider = provider

    while True:
        streamed_any = False
        this_error: Optional[str] = None
        async for kind, payload in _drain(active_provider, active_label):
            if kind == "text":
                yield payload
            else:
                streamed_any, this_error, stats = payload
                provider_tokens_in = stats["tokens_in"]
                provider_tokens_out = stats["tokens_out"]
                provider_latency = stats["latency_ms"]
        if streamed_any:
            model_id = active_provider.model
            label = active_label
            break
        # Nothing streamed; pick a different provider.
        last_error = this_error or last_error
        next_label = _next_fallback_label(tried)
        if not next_label:
            # Every provider failed. Surface something visible so the UI
            # doesn't appear frozen.
            note = last_error or "no working model available"
            msg = f"⚠️ Every model provider failed to respond ({note[:160]}). Please try again."
            full_response.append(msg)
            yield msg
            break
        tried.add(next_label)
        active_label = next_label
        active_provider = MODEL_REGISTRY[next_label]
        log.info(
            "route_query_falling_back",
            from_label=label if not tried - {label, next_label} else "chain",
            to_label=next_label, to_model=active_provider.model,
        )

    latency_ms = provider_latency if provider_latency is not None else (time.time() - start) * 1000
    log_model_usage(
        model=model_id,
        prompt=system[:500] + message,
        response="".join(full_response),
        latency_ms=latency_ms,
        query_type=label,
        tokens_in=provider_tokens_in,
        tokens_out=provider_tokens_out,
    )
