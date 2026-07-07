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

from app.services.model_provider import MODEL_REGISTRY, ModelResponse, call_with_resilience

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
#
# Per P1.5.d: the classifier prompt no longer names a "best model" for each
# label. The model→label mapping lives in MODEL_REGISTRY (Phase 1) and, from
# P1.5.e onward, is chosen by observed measured_fitness — not by benchmark
# citations. The classifier's job is to describe the SHAPE of the query;
# picking which provider serves that shape happens downstream.

CLASSIFIER_PROMPT = """You are a query router for an AI system. Classify this founder query into exactly one category. Reply with only the label, nothing else.

STRATEGIC — Multi-step reasoning, business-model critique, fundraising or investor prep, competitive positioning, go-to-market strategy, product tradeoffs, ambiguous judgment calls.

FACTUAL — Single-fact lookup, definition, quick summary of a known concept, template fill, formatting request, yes/no with brief explanation, math.

RESEARCH — Market sizing, competitor landscape, industry trends, current events, pricing data, anything requiring information newer than the model's training data.

DOCUMENT — Analyzing an uploaded document, reviewing a pitch deck, summarizing a long report, cross-referencing multiple sources, tasks where full document context is needed.

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


# ─── Council — seat, don't retrain (P1.5.f) ───────────────────────────────────
#
# Previously the council ran two DIFFERENT models (STRATEGIC + FACTUAL) in
# parallel to produce alternative perspectives. Per P1.5.f — "seat, don't
# retrain" — we now call the SAME STRATEGIC model N times with different
# curated context slices instead of standing up multiple models. This:
#   - stays cheaper and faster (one provider, one warm connection)
#   - avoids council results drifting when we swap the underlying
#     FACTUAL model
#   - keeps the perspectives semantically distinct via prompt lens, not
#     model choice
#
# Each entry in COUNCIL_LENSES is a (label, system-prompt-addendum) pair.
# The primary answer runs the base prompt; the council runs the same
# base prompt with each lens appended.

COUNCIL_LENSES = [
    (
        "consistency-check",
        "Adopt this lens: audit the primary answer's internal consistency. "
        "What claims contradict each other, or contradict the workspace "
        "context above? If you find no contradictions, say so briefly.",
    ),
    (
        "cost-risk",
        "Adopt this lens: focus purely on downside — capital burn, wasted "
        "cycles, opportunity cost, execution risk. What is the single "
        "highest-cost mistake the user could make acting on this question?",
    ),
]


async def _run_lens(lens_label: str, lens_addendum: str, system: str, message: str) -> dict:
    """Run the STRATEGIC model with the base system prompt + a lens addendum."""
    provider = MODEL_REGISTRY["STRATEGIC"]
    lens_system = _inject_format(system) + "\n\n---\nLENS: " + lens_addendum
    messages = [
        {"role": "system", "content": lens_system},
        {"role": "user", "content": message},
    ]
    parts = []
    err = None
    async for chunk in provider.complete(messages, stream=True, max_tokens=500):
        if chunk.error:
            err = chunk.error
            break
        if chunk.content:
            parts.append(chunk.content)
    if err:
        return {"model": lens_label, "response": f"[{lens_label} unavailable: {err[:80]}]"}
    return {"model": lens_label, "response": "".join(parts)}


async def get_council_perspectives(system: str, message: str) -> list[dict]:
    """
    Run N lenses in parallel on the STRATEGIC model and return their
    perspectives. Each perspective's `model` field is the LENS name
    (e.g. 'consistency-check'), not a model id — the frontend already
    treats it as a display label.
    """
    results = await asyncio.gather(
        *(_run_lens(label, addendum, system, message) for label, addendum in COUNCIL_LENSES),
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


async def route_query(
    system: str,
    message: str,
    max_tokens: int = 1200,
    model_override: Optional[str] = None,
    on_status=None,   # Optional[Callable[[str], Awaitable[None]]]
) -> AsyncIterator[str]:
    """
    Classify and stream from the best model.

    First yield is the model id string (for copilot.py to emit as a
    `model_used` SSE event). Subsequent yields are text deltas.

    Failure handling is delegated to model_provider.call_with_resilience
    — same-provider transient retry once, then cross-provider fallback.
    If every provider fails, we yield a visible error message so the UI
    never goes silent.

    on_status: optional async callback the caller can pass in to
    forward "retrying openai...", "switching to perplexity..." into
    their own SSE stream as `{"type": "status"}` events.
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
    final_model_used = model_id
    final_provider_name = provider.provider_name
    provider_tokens_in: Optional[int] = None
    provider_tokens_out: Optional[int] = None
    provider_latency: Optional[float] = None
    got_content = False

    async for chunk in call_with_resilience(
        label, messages,
        max_tokens=max_tokens,
        per_call_timeout_s=45.0,
        on_status=on_status,
    ):
        if chunk.content:
            got_content = True
            full_response.append(chunk.content)
            yield chunk.content
        if chunk.is_final:
            final_model_used = chunk.model_used or model_id
            final_provider_name = chunk.provider or provider.provider_name
            provider_tokens_in = chunk.tokens_in
            provider_tokens_out = chunk.tokens_out
            provider_latency = chunk.latency_ms
            if chunk.error and not got_content:
                # Total failure — surface something visible so the UI
                # never appears frozen.
                msg = f"⚠️ Every model provider failed to respond ({chunk.error[:160]}). Please try again."
                full_response.append(msg)
                yield msg

    latency_ms = provider_latency if provider_latency is not None else (time.time() - start) * 1000
    log_model_usage(
        model=final_model_used,
        prompt=system[:500] + message,
        response="".join(full_response),
        latency_ms=latency_ms,
        query_type=label,
        tokens_in=provider_tokens_in,
        tokens_out=provider_tokens_out,
    )
