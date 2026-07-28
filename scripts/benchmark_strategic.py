"""
Stage 10 — STRATEGIC-tier benchmark harness, same pattern as
scripts/benchmark_factual.py: runs the eval set through the actual
registered MODEL_REGISTRY["STRATEGIC"] provider (post model_registry DB
load, so this exercises the real DB-backed routing decision), scores it,
writes measured_fitness for label='STRATEGIC' in the same shape
refresh_measured_fitness() produces plus an additive `strategic_eval` block.

Eval set and scoring rubric are the same ones used to pick the model in
scripts/benchmark_strategic_candidates.py (concept-keyword coverage +
commits-to-a-position check) — reused here so the "which model" decision
and the "how well does the winner do, registered for real" measurement are
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

HEDGE_OPENERS = (
    "it depends", "that depends", "there's no one-size-fits-all",
    "there is no one-size-fits-all", "it's hard to say", "well, it depends",
)

EVAL_SET = [
    {
        "query": "A B2B SaaS startup charges a flat $99/month regardless of company size. Should they move to usage-based or tiered pricing? Give a clear recommendation.",
        "concepts": [["expansion revenue", "upsell", "land and expand", "land-and-expand"],
                     ["enterprise", "larger customers", "willingness to pay"],
                     ["predictab"]],
    },
    {
        "query": "We're raising a seed round. One investor offers a $2M SAFE at a $10M cap; another offers a priced equity round at the same valuation. Which should we take and why?",
        "concepts": [["dilution"], ["speed", "faster", "simpler", "legal cost", "legal fees"], ["valuation cap", "conversion", "discount"]],
    },
    {
        "query": "Our closest competitor just cut prices 30%. Should we match them?",
        "concepts": [["margin"], ["differentiat"], ["price war", "race to the bottom"]],
    },
    {
        "query": "Should an early-stage startup build its own authentication system or use a third-party provider like Auth0?",
        "concepts": [["build vs buy", "opportunity cost", "engineering time", "engineering resources"],
                     ["security", "compliance"], ["cost"]],
    },
    {
        "query": "We have 8 months of runway and flat growth. Should we cut burn now or push a growth experiment first?",
        "concepts": [["runway"], ["burn rate", "burn"], ["risk"]],
    },
    {
        "query": "A customer that accounts for 20% of our revenue is asking for a custom feature only they'd use. Build it or say no?",
        "concepts": [["concentration", "dependency", "single customer", "customer concentration"],
                     ["roadmap", "distraction", "opportunity cost"]],
    },
    {
        "query": "Should we go after enterprise customers or stay focused on SMB self-serve?",
        "concepts": [["sales cycle", "sales-led", "enterprise sales"],
                     ["self-serve", "self serve", "product-led", "product led", "plg"],
                     ["acv", "contract value", "deal size"]],
    },
    {
        "query": "Is it a good idea to add a free tier to our currently paid-only product?",
        "concepts": [["conversion", "funnel"], ["cannibaliz"], ["support cost", "cost to serve"]],
    },
]

SYSTEM = (
    "You are a startup strategy advisor. Lead with a clear recommendation "
    "in the first sentence, then support it. Address at least one real "
    "tradeoff or counterpoint. Do not hedge endlessly — commit to a position."
)


def score(answer: str, concepts: list) -> int:
    low = answer.lower()
    concept_hits = sum(1 for group in concepts if any(kw in low for kw in group))
    if concept_hits == 0:
        return 1
    hedges = any(low.strip().startswith(h) for h in HEDGE_OPENERS)
    word_count = len(answer.split())
    well_sized = 30 <= word_count <= 400
    if hedges or not well_sized:
        return 2
    return 5 if concept_hits >= 2 else 4


async def main():
    await load_registry_from_db()
    provider = MODEL_REGISTRY["STRATEGIC"]
    print(f"Benchmarking STRATEGIC -> provider_name={provider.provider_name!r} model={provider.model!r}\n")

    results = []
    for item in EVAL_SET:
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": item["query"]}]
        raw_chunks, latency_ms, error, tokens_out = [], None, None, None
        async for chunk in provider.complete(messages, stream=False, max_tokens=700, timeout_s=90.0):
            if chunk.error:
                error = chunk.error
            if chunk.content:
                raw_chunks.append(chunk.content)
            if chunk.is_final:
                latency_ms, tokens_out = chunk.latency_ms, chunk.tokens_out
        raw = "".join(raw_chunks)
        s = 1 if error else score(raw, item["concepts"])
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
        "by_query_type": {"STRATEGIC": {
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
        "strategic_eval": {
            "rubric": "1-5, concept-keyword coverage + commits-to-a-position check; see scripts/benchmark_strategic.py",
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
            "UPDATE model_registry SET measured_fitness = $1::jsonb WHERE label = 'STRATEGIC' RETURNING label, measured_fitness",
            _json.dumps(fitness_payload),
        )
    print(f"\nWrote measured_fitness for label={row['label']!r}")
    print(f"avg_score={avg_score}/5  avg_latency_ms={avg_latency_ms}")


asyncio.run(main())
