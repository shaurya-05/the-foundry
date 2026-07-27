"""
Stage 6 — CLASSIFIER-tier benchmark harness. Local-agent-loop, scoped
strictly to CLASSIFIER (per the ground-zero brief, Stage 6 item 24).

Why hand-written, not pulled from model_usage_log:
    model_usage_log doesn't exist in the local DB (confirmed:
    to_regclass('public.model_usage_log') returns NULL), and even if it
    did, ai_router.log_model_usage() is only ever called from
    route_query() — logging the ANSWERING tier's model/latency, tagged
    by the classifier's *output* label. classify_query() itself never
    logs on success. There has never been a code path that records a
    CLASSIFIER-tier call. So there is no history to pull from; this
    set is 100% hand-written, including two prompts with real
    confirmed behavior from this session's manual verification.

Scoring (1-5), applied to the RAW model output before classify_query's
own normalization/fallback:
    5 — predicted label matches expected, raw output was a single
        clean label token (no extra text)
    4 — predicted label matches expected, but raw output needed
        trimming (extra words/punctuation)
    3 — predicted label matches expected only because the raw output
        was unparseable and classify_query's error-fallback (STRATEGIC)
        happened to coincide with the expected label — not a real
        correctness signal, flagged separately
    2 — predicted label does not match expected, but is a defensible
        boundary case per CLASSIFIER_PROMPT's own documented ambiguity
    1 — predicted label does not match expected, no defensible reading

Writes into model_registry.measured_fitness for label='CLASSIFIER',
in the same top-level shape refresh_measured_fitness() produces
(window_days, calls_total, by_query_type, avg_latency_ms, p95_latency_ms,
avg_cost_usd, avg_tps, avg_efficiency, last_seen) so nothing that reads
the existing shape breaks, plus an additive `classification_eval` block
carrying the 1-5 rubric results this benchmark actually measures.
"""
import asyncio
import os
import statistics
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

os.environ.setdefault("DATABASE_URL", "postgresql://foundry:foundry_secret@localhost:5432/foundry_db")
os.environ.setdefault("OLLAMA_API_KEY", "ollama-local")

from app.services.ai_router import CLASSIFIER_PROMPT, VALID_LABELS
from app.services.model_provider import MODEL_REGISTRY, load_registry_from_db

EVAL_SET = [
    {
        "query": "Define runway in one sentence.",
        "expected": "FACTUAL",
        "alternates": [],
        "source": "confirmed real behavior, this session (HTTP /api/copilot/message)",
    },
    {
        "query": "What is a term sheet? Answer in one sentence.",
        "expected": "FACTUAL",
        "alternates": [],
        "source": "confirmed real behavior, this session (classify_query() direct call)",
    },
    {
        "query": "How many days are in a leap year?",
        "expected": "FACTUAL",
        "alternates": [],
        "source": "hand-written",
    },
    {
        "query": "Should we raise a priced round or a SAFE for our seed, given we have 14 months of runway and one competitor just raised $8M?",
        "expected": "STRATEGIC",
        "alternates": [],
        "source": "hand-written",
    },
    {
        "query": "We're deciding whether to sunset our freemium tier entirely or gate it further. Walk through the tradeoffs.",
        "expected": "STRATEGIC",
        "alternates": [],
        "source": "hand-written",
    },
    {
        "query": "What's the current market size for vertical SaaS in the audit/compliance space in North America?",
        "expected": "RESEARCH",
        "alternates": [],
        "source": "hand-written",
    },
    {
        "query": "What are competitors charging right now for API-based fraud detection tools?",
        "expected": "RESEARCH",
        "alternates": ["STRATEGIC"],
        "source": "hand-written",
    },
    {
        "query": "Summarize the key risks called out in this 40-page due diligence report.",
        "expected": "DOCUMENT",
        "alternates": [],
        "source": "hand-written",
    },
]

MODEL_COSTS_PER_M = {"input": 0.0, "output": 0.0}  # Ollama: local inference, no per-token billing


def score_result(expected: str, alternates: list, raw_output: str, normalized_label: str, was_fallback: bool) -> int:
    clean = raw_output.strip()
    single_token = clean.upper() == clean and len(clean.split()) == 1

    if normalized_label == expected:
        if was_fallback:
            return 3
        return 5 if single_token else 4
    if normalized_label in alternates:
        return 2
    return 1


async def run_prompt(provider, item: dict) -> dict:
    messages = [{"role": "user", "content": CLASSIFIER_PROMPT.format(query=item["query"])}]
    start = asyncio.get_event_loop().time()
    raw_chunks = []
    tokens_in = tokens_out = None
    latency_ms = None
    error = None

    async for chunk in provider.complete(messages, stream=False, max_tokens=10, timeout_s=15.0):
        if chunk.error:
            error = chunk.error
        if chunk.content:
            raw_chunks.append(chunk.content)
        if chunk.is_final:
            tokens_in, tokens_out, latency_ms = chunk.tokens_in, chunk.tokens_out, chunk.latency_ms

    raw_output = "".join(raw_chunks)
    if latency_ms is None:
        latency_ms = (asyncio.get_event_loop().time() - start) * 1000

    was_fallback = bool(error) or not raw_output.strip()
    normalized_label = raw_output.strip().upper() if not was_fallback else "STRATEGIC"
    if normalized_label not in VALID_LABELS:
        was_fallback = True
        normalized_label = "STRATEGIC"

    score = score_result(item["expected"], item["alternates"], raw_output, normalized_label, was_fallback)

    return {
        "query": item["query"],
        "source": item["source"],
        "expected": item["expected"],
        "raw_output": raw_output,
        "normalized_label": normalized_label,
        "was_fallback": was_fallback,
        "error": error,
        "score": score,
        "latency_ms": round(latency_ms, 1),
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }


async def main():
    await load_registry_from_db()
    provider = MODEL_REGISTRY["CLASSIFIER"]
    print(f"Benchmarking CLASSIFIER -> provider_name={provider.provider_name!r} model={provider.model!r}\n")

    results = []
    for item in EVAL_SET:
        r = await run_prompt(provider, item)
        results.append(r)
        status = "OK " if r["normalized_label"] == r["expected"] else "MISS"
        print(f"[{status}] score={r['score']}/5  expected={r['expected']:<10} got={r['normalized_label']:<10} "
              f"latency={r['latency_ms']}ms  raw={r['raw_output']!r}")

    n = len(results)
    avg_score = round(sum(r["score"] for r in results) / n, 2)
    latencies = [r["latency_ms"] for r in results]
    avg_latency_ms = round(statistics.mean(latencies), 1)
    p95_latency_ms = round(sorted(latencies)[int(0.95 * (n - 1))], 1)
    tps_values = [r["tokens_out"] / max(r["latency_ms"] / 1000, 0.001) for r in results if r["tokens_out"]]
    avg_tps = round(statistics.mean(tps_values), 1) if tps_values else 0.0

    by_query_type: dict[str, dict] = {}
    for r in results:
        bucket = by_query_type.setdefault(r["expected"], {"calls": 0, "correct": 0, "avg_latency_ms": []})
        bucket["calls"] += 1
        bucket["correct"] += int(r["normalized_label"] == r["expected"])
        bucket["avg_latency_ms"].append(r["latency_ms"])
    for qt, bucket in by_query_type.items():
        bucket["avg_latency_ms"] = round(statistics.mean(bucket["avg_latency_ms"]), 1)
        bucket["accuracy"] = round(bucket["correct"] / bucket["calls"], 2)

    fitness_payload = {
        "window_days": 0,  # not a rolling window — this is a point-in-time benchmark run
        "calls_total": n,
        "by_query_type": by_query_type,
        "avg_latency_ms": avg_latency_ms,
        "p95_latency_ms": p95_latency_ms,
        "avg_cost_usd": 0.0,
        "avg_tps": avg_tps,
        "avg_efficiency": 0.0,  # cost_usd is 0 (local inference) -> tokens/cost is undefined, not "infinite"
        "last_seen": datetime.now(timezone.utc).isoformat(),
        "classification_eval": {
            "rubric": "1-5, see scripts/benchmark_classifier.py docstring",
            "n_prompts": n,
            "avg_score": avg_score,
            "accuracy": round(sum(r["normalized_label"] == r["expected"] for r in results) / n, 2),
            "fallback_count": sum(r["was_fallback"] for r in results),
            "results": results,
        },
    }

    from app.db.postgres import get_pool
    import json as _json
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE model_registry SET measured_fitness = $1::jsonb WHERE label = 'CLASSIFIER' RETURNING label, measured_fitness",
            _json.dumps(fitness_payload),
        )
    print(f"\nWrote measured_fitness for label={row['label']!r}")
    print(f"avg_score={avg_score}/5  accuracy={fitness_payload['classification_eval']['accuracy']}  "
          f"avg_latency_ms={avg_latency_ms}  fallback_count={fitness_payload['classification_eval']['fallback_count']}")


asyncio.run(main())
