"""
Stage 9 — FACTUAL-tier benchmark harness, same pattern as
scripts/benchmark_classifier.py: runs the eval set through the actual
registered MODEL_REGISTRY["FACTUAL"] provider (post model_registry DB
load, so this exercises the real DB-backed routing decision from Stage
9's registry update), scores it, writes measured_fitness for
label='FACTUAL' in the same shape refresh_measured_fitness() produces
plus an additive `factual_eval` block.

Eval set and scoring rubric are the same ones used to pick the model in
scripts/benchmark_factual_candidates.py (objectively-checkable facts,
keyword-match scoring) — reused here so the "which model" decision and
the "how well does the winner do, registered for real" measurement are
directly comparable.
"""
import asyncio
import os
import statistics
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

os.environ.setdefault("DATABASE_URL", "postgresql://foundry:foundry_secret@localhost:5432/foundry_db")
os.environ.setdefault("OLLAMA_API_KEY", "ollama-local")

from app.services.model_provider import MODEL_REGISTRY, load_registry_from_db

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
    return 4 if (has_filler or is_long) else 5


async def main():
    await load_registry_from_db()
    provider = MODEL_REGISTRY["FACTUAL"]
    print(f"Benchmarking FACTUAL -> provider_name={provider.provider_name!r} model={provider.model!r}\n")

    results = []
    for item in EVAL_SET:
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": item["query"]}]
        raw_chunks, latency_ms, error, tokens_out = [], None, None, None
        async for chunk in provider.complete(messages, stream=False, max_tokens=150, timeout_s=30.0):
            if chunk.error:
                error = chunk.error
            if chunk.content:
                raw_chunks.append(chunk.content)
            if chunk.is_final:
                latency_ms, tokens_out = chunk.latency_ms, chunk.tokens_out
        raw = "".join(raw_chunks)
        s = 1 if error else score(raw, item["keywords"])
        r = {"query": item["query"], "raw_output": raw, "score": s,
             "latency_ms": round(latency_ms or 0, 1), "tokens_out": tokens_out, "error": error}
        results.append(r)
        print(f"[{'OK  ' if s >= 4 else 'MISS'}] score={s}/5 latency={r['latency_ms']}ms "
              f"query={item['query'][:45]!r} raw={raw[:70]!r}")

    n = len(results)
    avg_score = round(sum(r["score"] for r in results) / n, 2)
    latencies = [r["latency_ms"] for r in results]
    avg_latency_ms = round(statistics.mean(latencies), 1)
    p95_latency_ms = round(sorted(latencies)[int(0.95 * (n - 1))], 1)
    tps_values = [r["tokens_out"] / max(r["latency_ms"] / 1000, 0.001) for r in results if r["tokens_out"]]
    avg_tps = round(statistics.mean(tps_values), 1) if tps_values else 0.0

    fitness_payload = {
        "window_days": 0,
        "calls_total": n,
        "by_query_type": {"FACTUAL": {
            "calls": n,
            "correct": sum(1 for r in results if r["score"] >= 4),
            "accuracy": round(sum(1 for r in results if r["score"] >= 4) / n, 2),
            "avg_latency_ms": avg_latency_ms,
        }},
        "avg_latency_ms": avg_latency_ms,
        "p95_latency_ms": p95_latency_ms,
        "avg_cost_usd": 0.0,
        "avg_tps": avg_tps,
        "avg_efficiency": 0.0,
        "last_seen": datetime.now(timezone.utc).isoformat(),
        "factual_eval": {
            "rubric": "1-5, keyword-match against objectively-checkable facts; see scripts/benchmark_factual.py",
            "n_prompts": n,
            "avg_score": avg_score,
            "results": results,
        },
    }

    from app.db.postgres import get_pool
    import json as _json
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE model_registry SET measured_fitness = $1::jsonb WHERE label = 'FACTUAL' RETURNING label, measured_fitness",
            _json.dumps(fitness_payload),
        )
    print(f"\nWrote measured_fitness for label={row['label']!r}")
    print(f"avg_score={avg_score}/5  avg_latency_ms={avg_latency_ms}")


asyncio.run(main())
