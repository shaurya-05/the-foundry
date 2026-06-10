"""
AI Router — data-backed model selection for FOUND3RY
Classifier runs on Claude Haiku. All routing decisions logged via model_used.
"""

import os
import json
import httpx
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

def _anthropic():
    return AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

def _openai():
    return AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY")
PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions"

CLASSIFIER_PROMPT = """Classify this founder query into exactly one category. Reply with only the label, nothing else.

Categories:
STRATEGIC - complex reasoning, business decisions, investor prep, model critique, nuanced tradeoffs
FACTUAL - simple lookups, quick summaries, formatting, template fills, short confirmations
RESEARCH - market data, competitor info, real-time facts, current state of anything
DOCUMENT - analyzing long documents, pitch decks, large context tasks

Query: {query}

Label:"""

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

async def stream_strategic(system: str, message: str, max_tokens: int = 800):
    """Claude Sonnet 4 — complex reasoning, default for ambiguous queries."""
    async with _anthropic().messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": message}],
    ) as stream:
        async for text in stream.text_stream:
            yield text

async def stream_factual(system: str, message: str, max_tokens: int = 800):
    """GPT-4o Mini — simple lookups and formatting. 20x cheaper than Sonnet."""
    response = await _openai().chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=max_tokens,
        stream=True,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": message},
        ],
    )
    async for chunk in response:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta

async def stream_research(system: str, message: str, max_tokens: int = 800):
    """Perplexity Sonar — live web access for market and competitor research."""
    if not PERPLEXITY_API_KEY:
        async for text in stream_strategic(system, message, max_tokens):
            yield text
        return
    headers = {
        "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "sonar",
        "stream": True,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
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

async def stream_document(system: str, message: str, max_tokens: int = 800):
    """Gemini 1.5 Flash — large context. Falls back to Claude if no key."""
    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        async for text in stream_strategic(system, message, max_tokens):
            yield text
        return
    gemini_client = AsyncOpenAI(
        api_key=gemini_key,
        base_url="https://generativeai.googleapis.com/v1beta/openai/",
    )
    response = await gemini_client.chat.completions.create(
        model="gemini-1.5-flash",
        max_tokens=max_tokens,
        stream=True,
        messages=[
            {"role": "system", "content": system},
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

async def route_query(system: str, message: str, max_tokens: int = 800):
    """
    Classify and stream from the best model.
    First yield is always the model_used string.
    Subsequent yields are text deltas.
    """
    label = await classify_query(message)
    model_used, handler = ROUTE_MAP[label]
    yield model_used
    async for text in handler(system, message, max_tokens):
        yield text
