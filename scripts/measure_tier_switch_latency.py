"""
Task 1 (post-STRATEGIC-migration gap closure) — measure the real cost of
OLLAMA_MAX_LOADED_MODELS=1 forcing a full model swap on every tier switch,
instead of assuming the 25-request sustained-traffic test (which never
crashed) meant the latency was fine.

Times the CLASSIFIER phase and the answering-tier phase SEPARATELY (calling
classify_query() and the answering provider's .complete() directly, not
through route_query()'s combined streaming path) so swap cost is
attributable to a specific model, not lumped into one end-to-end number.

Critical architectural fact this test is designed to surface: CLASSIFIER
runs before EVERY request regardless of destination tier. Under
MAX_LOADED_MODELS=1, that means CLASSIFIER's swap-in evicts whatever
answered last, and then the destination tier's swap-in evicts CLASSIFIER
-- every single request pays two full swaps, whether or not the
destination tier matches the previous request's destination tier. The
hypothesis this test checks: "same-tier repeat" and "different-tier
switch" should show near-IDENTICAL latency under this config, because
there is no such thing as a true no-swap repeat while CLASSIFIER sits
between every request and the answering model.
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
os.environ.setdefault("DATABASE_URL", "postgresql://foundry:foundry_secret@localhost:5432/foundry_db")
os.environ.setdefault("OLLAMA_API_KEY", "ollama-local")

from app.services.ai_router import classify_query
from app.services.model_provider import MODEL_REGISTRY, load_registry_from_db

# (query, expected_tier, "repeat"|"switch" relative to the previous entry's
# expected_tier -- label is descriptive only, not enforced)
SEQUENCE = [
    ("What does MRR stand for? One sentence.", "FACTUAL", "first"),
    ("What is 12 times 11?", "FACTUAL", "repeat"),
    ("Should we raise a priced round or a SAFE given 14 months of runway? Give a clear recommendation.", "STRATEGIC", "switch"),
    ("Should an early-stage startup build auth in-house or use a third-party provider? Give a clear recommendation.", "STRATEGIC", "repeat"),
    ("How many days are in a leap year?", "FACTUAL", "switch"),
    ("Our closest competitor just cut prices 30%. Should we match them? Give a clear strategic recommendation with tradeoffs.", "STRATEGIC", "switch"),
    ("A customer worth 20% of revenue wants a custom feature only they'd use. Build it or say no? Give a clear recommendation.", "STRATEGIC", "repeat"),
    ("What is the capital of France? One sentence.", "FACTUAL", "switch"),
    ("What year did World War II end?", "FACTUAL", "repeat"),
    ("Should we go after enterprise customers or stay SMB self-serve? Give a clear strategic recommendation.", "STRATEGIC", "switch"),
    ("Define runway in a startup context, one sentence.", "FACTUAL", "switch"),
    ("How many continents are there?", "FACTUAL", "repeat"),
    ("Is it a good idea to add a free tier to our currently paid-only product? Give a clear recommendation.", "STRATEGIC", "switch"),
    ("Should an early-stage startup build its own authentication system or use Auth0? Give a clear recommendation.", "STRATEGIC", "repeat"),
    ("What does SAFE stand for in startup fundraising? One sentence.", "FACTUAL", "switch"),
]

SYSTEM = "You are a helpful assistant."


async def timed_call(query: str):
    t0 = time.time()
    label = await classify_query(query)
    t1 = time.time()
    classify_ms = (t1 - t0) * 1000

    provider = MODEL_REGISTRY.get(label)
    answer_ms = None
    error = None
    if provider is not None and provider.is_configured():
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": query}]
        t2 = time.time()
        async for chunk in provider.complete(messages, stream=False, max_tokens=150, timeout_s=60.0):
            if chunk.error:
                error = chunk.error
            if chunk.is_final:
                pass
        answer_ms = (time.time() - t2) * 1000
    return label, classify_ms, answer_ms, error


async def main():
    await load_registry_from_db()
    print(f"CLASSIFIER -> {MODEL_REGISTRY['CLASSIFIER'].provider_name}/{MODEL_REGISTRY['CLASSIFIER'].model}")
    print(f"FACTUAL    -> {MODEL_REGISTRY['FACTUAL'].provider_name}/{MODEL_REGISTRY['FACTUAL'].model}")
    print(f"STRATEGIC  -> {MODEL_REGISTRY['STRATEGIC'].provider_name}/{MODEL_REGISTRY['STRATEGIC'].model}\n")

    results = []
    for query, expected_tier, kind in SEQUENCE:
        label, classify_ms, answer_ms, error = await timed_call(query)
        total_ms = classify_ms + (answer_ms or 0)
        results.append({
            "query": query, "expected_tier": expected_tier, "kind": kind,
            "actual_label": label, "classify_ms": classify_ms, "answer_ms": answer_ms,
            "total_ms": total_ms, "error": error,
        })
        print(f"[{kind:6}] expected={expected_tier:10} actual={label:10} "
              f"classify={classify_ms:7.0f}ms answer={(answer_ms or 0):7.0f}ms total={total_ms:7.0f}ms "
              f"{'ERROR: ' + error if error else ''} query={query[:40]!r}")

    misclassified = [r for r in results if r["actual_label"] != r["expected_tier"]]
    if misclassified:
        print(f"\n--- Misclassifications (excluded from tier breakdown below, reported separately) ---")
        for r in misclassified:
            print(f"  expected={r['expected_tier']} actual={r['actual_label']} query={r['query'][:60]!r}")

    print("\n--- Breakdown: repeat vs switch, by ACTUAL destination tier (not expected) ---")
    for tier in ("FACTUAL", "STRATEGIC"):
        # Grouped by actual_label, since that's what really executed and
        # what the answer_ms actually measures -- grouping by expected_tier
        # would silently mix in answers from a different (misclassified)
        # model's latency profile.
        repeats = [r for r in results if r["actual_label"] == tier and r["kind"] == "repeat"]
        switches = [r for r in results if r["actual_label"] == tier and r["kind"] == "switch"]
        avg_repeat = avg_switch = None
        if repeats:
            avg_repeat = sum(r["total_ms"] for r in repeats) / len(repeats)
            print(f"{tier} REPEAT  (n={len(repeats)}): avg_total={avg_repeat:.0f}ms  "
                  f"individual={[round(r['total_ms']) for r in repeats]}")
        if switches:
            avg_switch = sum(r["total_ms"] for r in switches) / len(switches)
            print(f"{tier} SWITCH  (n={len(switches)}): avg_total={avg_switch:.0f}ms  "
                  f"individual={[round(r['total_ms']) for r in switches]}")
        if avg_repeat and avg_switch:
            delta = avg_switch - avg_repeat
            print(f"{tier} DELTA (switch - repeat): {delta:+.0f}ms\n")

    print("--- Phase breakdown (classify vs answer, all requests) ---")
    avg_classify = sum(r["classify_ms"] for r in results) / len(results)
    avg_answer = sum(r["answer_ms"] for r in results if r["answer_ms"]) / len([r for r in results if r["answer_ms"]])
    print(f"avg classify_ms={avg_classify:.0f}  avg answer_ms={avg_answer:.0f}")


asyncio.run(main())
