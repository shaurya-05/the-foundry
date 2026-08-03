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
import json
import os
import time
from typing import AsyncIterator, Optional

import structlog

from app.services import document_retrieval, web_search
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

STRATEGIC — Multi-step reasoning, business-model critique, fundraising or investor prep, competitive positioning, go-to-market strategy, product tradeoffs, ambiguous judgment calls. Includes reacting to something that happened in THE USER'S OWN BUSINESS (their churn rate, their metrics, their team, their customers) — that's an internal judgment call, not external research, even if it just happened.

FACTUAL — Single-fact lookup, definition, quick summary of a known STABLE concept (something with one correct answer that doesn't change over time — historical dates, math, standard business terms, established facts), template fill, formatting request, yes/no with brief explanation.

RESEARCH — Needs CURRENT information about the OUTSIDE WORLD that only a live web search could answer correctly: today's news, this week's external events, current/latest market prices or interest rates or stock values, a specific company's current funding/valuation, general market sizing or competitor landscape. Trigger words pointing here: "current", "latest", "today", "this week", "right now" -- but ONLY when paired with something external and publicly changeable (prices, news, rates, funding rounds), never the user's own business data or documents. A stable historical fact (e.g. "what year did X launch") is FACTUAL even if it mentions a company; that same company's live stock price or this week's headlines about it is RESEARCH.

DOCUMENT — Analyzing, summarizing, or comparing SPECIFIC MATERIALS the user has (or would have) provided or referenced -- decks, contracts, transcripts, reports, codebases, past internal updates -- regardless of what time periods those materials cover. Comparing "our Q1 vs Q3 deck" or "our last three updates" is DOCUMENT, not RESEARCH, because the source is the user's own provided material, not a live external lookup.

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


# Injected into the system prompt when a query classifies as RESEARCH or
# DOCUMENT but that tier's provider isn't configured (no PERPLEXITY_API_KEY
# / GEMINI_API_KEY -- true for this local-only deployment). Without this,
# call_with_resilience silently falls back to STRATEGIC/FACTUAL, and that
# model has no idea it's being asked something it structurally can't
# answer -- it just generates a plausible-sounding response. For RESEARCH
# that means presenting stale training-data knowledge as if it were
# current (e.g. "As of my last update in October 2023, the Fed rate
# is..."); for DOCUMENT it means inventing content for documents it was
# never given. Comprehensive eval (scripts/comprehensive_evaluation.py)
# surfaced this as a real trust gap, not just a routing quirk -- the fix
# is a prompt-level caveat at the exact point we know a fallback is about
# to happen, not a routing change (RESEARCH/DOCUMENT classification itself
# was reasonably accurate; the danger was in the *unflagged* fallback).
_UNCONFIGURED_TIER_CAVEATS = {
    "RESEARCH": (
        "\n\nIMPORTANT: This question asks for current or real-time information "
        "(news, prices, rates, recent events, anything time-sensitive) that you "
        "do NOT have access to -- you have no web access and a training "
        "cutoff. Do not present old training data as if it were current. "
        "State plainly that you can't check live data for this, give general "
        "context only if it's genuinely still useful, and suggest where the "
        "user could find current information."
    ),
    "DOCUMENT": (
        "\n\nIMPORTANT: This question asks you to reference specific documents "
        "(contracts, decks, transcripts, code, reports, etc.) that have NOT "
        "been provided in this conversation -- you have no actual access to "
        "the user's files. Do not invent or assume specific document "
        "content. State plainly that you don't have those documents in this "
        "conversation, and ask the user to paste or share the relevant "
        "content if they want it analyzed."
    ),
}


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


# ─── RESEARCH: real web search via tool-calling ──────────────────────────────
# Two-call pattern, both non-streaming: first call gives the local model a
# web_search tool and lets it decide the query; second call feeds the real
# search results back and asks for a grounded, cited answer. Deliberately
# NOT a single streaming call with tool support -- see model_provider.py's
# module docstring on why streaming tool-call delta accumulation was never
# implemented (this two-call shape doesn't need it).

WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the live web for current, real-time information that isn't in your training data (news, prices, rates, recent events).",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "The search query"}},
            "required": ["query"],
        },
    },
}


async def _research_with_web_search(system: str, message: str, provider, max_tokens: int) -> str:
    """
    Real RESEARCH: ask the local model to call web_search, execute the
    actual search via Tavily, then synthesize a final answer grounded in
    those results. Every failure mode (model doesn't call the tool,
    search API returns nothing) produces an honest "couldn't find that"
    message -- never lets the model guess in place of a failed search.
    """
    decide_messages = [
        {"role": "system", "content": system + "\n\nYou have a web_search tool for anything needing current/live information. Use it before answering."},
        {"role": "user", "content": message},
    ]
    tool_calls = None
    async for chunk in provider.complete(decide_messages, tools=[WEB_SEARCH_TOOL], stream=False, max_tokens=200, timeout_s=30.0):
        if chunk.is_final:
            tool_calls = chunk.tool_calls

    if not tool_calls:
        return "I wasn't able to determine what to search for from that question — could you rephrase it?"

    search_query = message
    try:
        args = json.loads(tool_calls[0]["arguments"])
        search_query = args.get("query", message)
    except Exception:
        pass

    results = await web_search.search(search_query)
    if not results:
        return (
            "I tried to search the web for this but the search came back empty "
            "(or web search isn't configured right now) — I don't have a "
            "reliable answer to give you without live data for this one."
        )

    formatted_results = "\n\n".join(
        f"[{i + 1}] {r['title']} ({r['url']})\n{r['content']}" for i, r in enumerate(results)
    )
    synth_messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": (
            f"{message}\n\nHere are real, current web search results to answer this:\n\n"
            f"{formatted_results}\n\nAnswer using ONLY this information. Cite sources "
            f"inline like [1], [2]. If these results don't actually answer the "
            f"question, say so plainly rather than filling the gap yourself."
        )},
    ]
    answer_chunks = []
    async for chunk in provider.complete(synth_messages, stream=False, max_tokens=max_tokens, timeout_s=45.0):
        if chunk.content:
            answer_chunks.append(chunk.content)
    return "".join(answer_chunks) or "I found search results but couldn't synthesize an answer from them — please try again."


async def route_query(
    system: str,
    message: str,
    max_tokens: int = 1200,
    model_override: Optional[str] = None,
    on_status=None,   # Optional[Callable[[str], Awaitable[None]]]
    history: Optional[list[dict[str, str]]] = None,
    workspace_id: Optional[str] = None,
) -> AsyncIterator[str | tuple[str, str]]:
    """
    Classify and stream from the best model.

    First yield is the model id string (for copilot.py to emit as a
    `model_used` SSE event). Subsequent yields are text deltas (str),
    except for one possible final `("model_used", <model>)` tuple if
    call_with_resilience fell back to a different provider than the one
    named in the first yield -- callers should treat a tuple yield as a
    correction to the model_used they already emitted, not text content.

    history: prior turns in this conversation, oldest first, each
    {"role": "user"|"assistant", "content": ...}. Caller (copilot.py) is
    responsible for bounding this to a sensible token budget -- local
    Ollama models here run a 4096-token context window total, shared
    between system prompt, history, the new message, and max_tokens of
    room for the reply.

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

    formatted_system = _inject_format(system)

    # RESEARCH: real web search when both a local model and Tavily are
    # available. This is a self-contained two-call flow (see
    # _research_with_web_search) that doesn't go through
    # call_with_resilience -- returns directly rather than falling
    # through to the standard single-call path below.
    if label == "RESEARCH" and provider.is_configured() and web_search.is_configured():
        start = time.time()
        answer = await _research_with_web_search(formatted_system, message, provider, max_tokens)
        yield answer
        log_model_usage(
            model=provider.model, prompt=system[:500] + message, response=answer,
            latency_ms=(time.time() - start) * 1000, query_type=label,
        )
        return

    # DOCUMENT: real retrieval from the user's knowledge base when both a
    # local model and Voyage embeddings are available. `document_context`
    # stays None (not just "unconfigured") whenever retrieval genuinely
    # finds nothing relevant -- that's the signal the caveat below keys
    # on, not provider.is_configured(), since a local DOCUMENT model can
    # be perfectly configured and still have nothing real to answer from.
    document_context = None
    if label == "DOCUMENT" and provider.is_configured() and workspace_id and document_retrieval.is_configured():
        document_context = await document_retrieval.retrieve_context(workspace_id, message)

    if document_context:
        formatted_system += (
            "\n\nThe following is real content retrieved from the user's "
            "knowledge base because it's relevant to this question. Base "
            "your answer on it. If it doesn't fully answer the question, "
            "say what's missing rather than filling the gap with "
            "assumptions.\n\n" + document_context
        )
    elif label in _UNCONFIGURED_TIER_CAVEATS:
        # Reaching this point for RESEARCH means the tool-calling path
        # above didn't fire (no local model, no Tavily, or the model
        # chose not to search). For DOCUMENT it means retrieval found
        # nothing real (unconfigured, embedding failure, or a genuine
        # no-match). Either way: be honest, don't guess.
        formatted_system += _UNCONFIGURED_TIER_CAVEATS[label]

    messages = [
        {"role": "system", "content": formatted_system},
        *(history or []),
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

    # call_with_resilience can fall back to a different provider than the
    # one named in the first yield above (e.g. STRATEGIC's Anthropic key
    # missing -> silently answered by FACTUAL instead). Without this,
    # callers that only read the first yield as "the model" report a
    # model that never actually generated the content -- both the SSE
    # model_used event and the persisted copilot_messages.model_used
    # column end up wrong. Re-yield the label so copilot.py can correct
    # both.
    if final_model_used != model_id:
        yield ("model_used", final_model_used)

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
