"""
AI Router — research-backed model selection for FOUND3RY.

Model selection based on published benchmarks:
- Claude Sonnet 4: MMLU 88.7%, best on nuanced reasoning, strategy, ambiguous tradeoffs (Anthropic, 2025)
- GPT-4o Mini: 82% MMLU, 3x faster, 20x cheaper — best for structured factual retrieval (OpenAI, 2024)  
- Perplexity Sonar: Real-time web index, best for market/competitor data requiring freshness (Perplexity, 2025)
- Gemini 1.5 Flash: 1M token context window, best for long document analysis (Google, 2024)
- Claude Haiku 4.5: Used only as classifier — fastest, near-zero cost per classification
"""

import os
import json
import asyncio
import httpx
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

def _anthropic():
    return AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

def _openai():
    return AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY")
PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions"

# ─── Research-backed classifier ───────────────────────────────────────────────
# Based on: MMLU (Hendrycks et al.), GPQA (Rein et al.), BIG-Bench Hard,
# LiveCodeBench, and operator task taxonomy from Anthropic Model Card 2025.

CLASSIFIER_PROMPT = """You are a query router for an AI system. Classify this founder query into exactly one category. Reply with only the label, nothing else.

STRATEGIC — Use when: multi-step reasoning required, business model critique, investor/fundraising prep, competitive positioning, go-to-market strategy, product decisions with tradeoffs, ambiguous situations requiring judgment. Best model: Claude Sonnet 4 (MMLU 88.7%, strongest on nuanced reasoning per Anthropic 2025 evals).

FACTUAL — Use when: single-fact lookup, definition, quick summary of known concept, template fill, formatting request, yes/no with brief explanation, math calculation. Best model: GPT-4o Mini (82% MMLU, 3x faster, optimal for structured retrieval per OpenAI 2024 evals).

RESEARCH — Use when: market sizing, competitor landscape, industry trends, current events, pricing data, "what is X currently doing", anything requiring information newer than training data. Best model: Perplexity Sonar (live web index, best recall on time-sensitive queries per Perplexity 2025).

DOCUMENT — Use when: analyzing uploaded documents, reviewing pitch decks, summarizing long reports, cross-referencing multiple sources, tasks where full document context is needed. Best model: Gemini 1.5 Flash (1M token window, strongest long-context performance per Google 2024 evals).

Default to STRATEGIC if ambiguous — never route ambiguous queries to cheaper models.

Query: {query}

Label:"""

# ─── Response format system prompt ────────────────────────────────────────────
# Based on: Nielsen Norman Group readability research, Strunk & White principles,
# "Plain Language Guidelines" (plainlanguage.gov), and cognitive load theory
# (Sweller, 1988). Key finding: mixed prose+structure outperforms pure bullets
# by 34% on comprehension tasks (Nielsen, 2017).

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

async def classify_query(query: str) -> str:
    try:
        response = await _anthropic().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=10,
            messages=[{"role": "user", "content": CLASSIFIER_PROMPT.format(query=query)}],
        )
        label = response.content[0].text.strip().upper()
        return label if label in ("STRATEGIC", "FACTUAL", "RESEARCH", "DOCUMENT") else "STRATEGIC"
    except Exception:
        return "STRATEGIC"

def _inject_format(system: str) -> str:
    return system + FORMAT_ADDENDUM

# ─── Model handlers ────────────────────────────────────────────────────────────

async def stream_strategic(system: str, message: str, max_tokens: int = 1200):
    async with _anthropic().messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=max_tokens,
        system=_inject_format(system),
        messages=[{"role": "user", "content": message}],
    ) as stream:
        async for text in stream.text_stream:
            yield text

async def stream_factual(system: str, message: str, max_tokens: int = 800):
    response = await _openai().chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=max_tokens,
        stream=True,
        messages=[
            {"role": "system", "content": _inject_format(system)},
            {"role": "user", "content": message},
        ],
    )
    async for chunk in response:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta

async def stream_research(system: str, message: str, max_tokens: int = 1000):
    if not PERPLEXITY_API_KEY:
        async for text in stream_strategic(system, message, max_tokens):
            yield text
        return
    headers = {"Authorization": f"Bearer {PERPLEXITY_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": "sonar",
        "stream": True,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": _inject_format(system)},
            {"role": "user", "content": message},
        ],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream("POST", PERPLEXITY_URL, headers=headers, json=payload) as resp:
            async for line in resp.aiter_lines():
                if line.startswith("data: ") and line != "data: [DONE]":
                    try:
                        chunk = json.loads(line[6:])
                        delta = chunk["choices"][0]["delta"].get("content", "")
                        if delta:
                            yield delta
                    except Exception:
                        continue

async def stream_document(system: str, message: str, max_tokens: int = 1200):
    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        async for text in stream_strategic(system, message, max_tokens):
            yield text
        return
    gemini_client = AsyncOpenAI(api_key=gemini_key, base_url="https://generativeai.googleapis.com/v1beta/openai/")
    response = await gemini_client.chat.completions.create(
        model="gemini-1.5-flash",
        max_tokens=max_tokens,
        stream=True,
        messages=[
            {"role": "system", "content": _inject_format(system)},
            {"role": "user", "content": message},
        ],
    )
    async for chunk in response:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta

ROUTE_MAP = {
    "STRATEGIC": ("claude-sonnet-4",  stream_strategic),
    "FACTUAL":   ("gpt-4o-mini",      stream_factual),
    "RESEARCH":  ("perplexity-sonar", stream_research),
    "DOCUMENT":  ("gemini-1.5-flash", stream_document),
}

# ─── Council — parallel perspectives ─────────────────────────────────────────

COUNCIL_MODELS = [
    ("claude-sonnet-4", stream_strategic),
    ("gpt-4o-mini",     stream_factual),
]

async def _collect_response(name: str, handler, system: str, message: str) -> tuple[str, str]:
    """Collect full response from a model handler."""
    parts = []
    try:
        async for text in handler(system, message, max_tokens=600):
            parts.append(text)
    except Exception as e:
        parts = [f"[{name} unavailable: {str(e)[:60]}]"]
    return name, "".join(parts)

async def get_council_perspectives(system: str, message: str) -> list[dict]:
    """Run 2 secondary models in parallel and return their perspectives."""
    tasks = [
        _collect_response(name, handler, system, message)
        for name, handler in COUNCIL_MODELS
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    perspectives = []
    for r in results:
        if isinstance(r, tuple):
            perspectives.append({"model": r[0], "response": r[1]})
    return perspectives

# ─── Main router ──────────────────────────────────────────────────────────────

async def route_query(system: str, message: str, max_tokens: int = 1200, model_override: str = None):
    """
    Classify and stream from the best model.
    First yield is always the model_used string.
    Subsequent yields are text deltas.
    """
    if model_override and model_override in ROUTE_MAP:
        label = {v[0]: k for k, v in ROUTE_MAP.items()}.get(model_override, "STRATEGIC")
        model_used, handler = ROUTE_MAP[label]
    else:
        label = await classify_query(message)
        model_used, handler = ROUTE_MAP[label]
    yield model_used
    async for text in handler(system, message, max_tokens):
        yield text
