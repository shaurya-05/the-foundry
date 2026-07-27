"""
Stage 9 — decide between qwen2.5:7b-instruct and llama3.1:8b-instruct for
the FACTUAL tier by actually benchmarking both, not assuming. Uses the
real OpenAICompatibleProvider class against local Ollama for each
candidate, independent of MODEL_REGISTRY (no wiring decision made yet).

FACTUAL is an answering tier, not a classifier — so unlike Stage 6's
label-match scoring, correctness here is checked by keyword/substring
matching against objectively-verifiable facts (dates, math, standard
definitions). Deliberately picked prompts with unambiguous correct
answers so this stays a simple, mechanical rubric, matching the
project's own "simple 1-5 rubric" framing rather than an LLM-judge setup.

Rubric (1-5) per answer:
    5 — key fact present, answer led with it directly (no filler),
        reasonably concise
    4 — key fact present, but hedged/filler opener or noticeably long
    2 — key fact present only partially/ambiguously
    1 — key fact absent or wrong
"""
import asyncio
import os
import statistics
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
os.environ.setdefault("OLLAMA_API_KEY", "ollama-local")

from app.services.model_provider import OpenAICompatibleProvider

FILLER_OPENERS = ("great question", "certainly", "of course", "i'd be happy", "as an ai", "sure!", "sure,")

EVAL_SET = [
    {"query": "What is the capital of France? Answer in one sentence.", "keywords": ["paris"]},
    {"query": "What is 17 times 23? Just the number and a brief check.", "keywords": ["391"]},
    {"query": "How many continents are there?", "keywords": ["seven", "7"]},
    {"query": "What year did World War II end?", "keywords": ["1945"]},
    {"query": "How many days are in a leap year?", "keywords": ["366"]},
    {"query": "What does MRR stand for in a SaaS business?", "keywords": ["monthly recurring revenue"]},
    {"query": "What is a SAFE in startup fundraising? One sentence.", "keywords": ["simple agreement for future equity"]},
    {"query": "Define runway in a startup context, one sentence.", "keywords": ["months", "cash", "burn", "runway"]},
]

CANDIDATES = ["qwen2.5:7b-instruct", "llama3.1:8b"]

SYSTEM = (
    "Answer directly in the first sentence. Never use filler phrases like "
    "'Great question' or 'Certainly'. Be concise."
)


def score(raw: str, keywords: list) -> int:
    low = raw.lower()
    has_fact = any(k.lower() in low for k in keywords)
    if not has_fact:
        return 1
    has_filler = any(low.strip().startswith(f) for f in FILLER_OPENERS)
    is_long = len(raw.split()) > 60
    if has_filler or is_long:
        return 4
    return 5


async def run_candidate(model: str) -> dict:
    provider = OpenAICompatibleProvider(
        api_key_env="OLLAMA_API_KEY", model=model, provider_name="ollama",
        base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
    )
    results = []
    for item in EVAL_SET:
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": item["query"]}]
        raw_chunks = []
        latency_ms = None
        error = None
        async for chunk in provider.complete(messages, stream=False, max_tokens=150, timeout_s=30.0):
            if chunk.error:
                error = chunk.error
            if chunk.content:
                raw_chunks.append(chunk.content)
            if chunk.is_final:
                latency_ms = chunk.latency_ms
        raw = "".join(raw_chunks)
        s = 1 if error else score(raw, item["keywords"])
        results.append({
            "query": item["query"], "raw": raw, "score": s,
            "latency_ms": round(latency_ms or 0, 1), "error": error,
        })
        tag = "OK  " if s >= 4 else "WEAK" if s > 1 else "MISS"
        print(f"  [{tag}] score={s}/5 latency={results[-1]['latency_ms']}ms "
              f"query={item['query'][:45]!r} raw={raw[:70]!r}")

    avg_score = round(sum(r["score"] for r in results) / len(results), 2)
    avg_latency = round(statistics.mean(r["latency_ms"] for r in results), 1)
    return {"model": model, "avg_score": avg_score, "avg_latency_ms": avg_latency, "results": results}


async def main():
    summaries = []
    for model in CANDIDATES:
        print(f"\n=== {model} ===")
        summaries.append(await run_candidate(model))

    print("\n--- Comparison ---")
    for s in summaries:
        print(f"{s['model']:<24} avg_score={s['avg_score']}/5  avg_latency_ms={s['avg_latency_ms']}")

    winner = max(summaries, key=lambda s: (s["avg_score"], -s["avg_latency_ms"]))
    print(f"\nWinner (highest avg_score, tie-break lower latency): {winner['model']}")


asyncio.run(main())
