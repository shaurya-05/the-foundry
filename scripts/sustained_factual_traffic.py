"""
Stage 9 — sustained traffic for FACTUAL, run alongside CLASSIFIER calls
(via the real route_query()/classify_query() path) so both Ollama models
are genuinely coexisting in VRAM under real conditions, not tested in
isolation. Watches for crashes and reload-latency spikes, same as
scripts/sustained_classifier_traffic.py.
"""
import asyncio
import os
import time
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
os.environ.setdefault("DATABASE_URL", "postgresql://foundry:foundry_secret@localhost:5432/foundry_db")
os.environ.setdefault("OLLAMA_API_KEY", "ollama-local")

from app.services.ai_router import route_query
from app.services.model_provider import MODEL_REGISTRY, load_registry_from_db

# Mix of FACTUAL-bound and STRATEGIC/RESEARCH/DOCUMENT-bound queries so
# classify_query() (CLASSIFIER, warm on the 3B model) and route_query()'s
# actual answering call (FACTUAL, warm on the 7B model) both fire on
# every round -- real interleaved dual-model traffic, not FACTUAL alone.
PROMPTS = [
    "What does MRR stand for? One sentence.",
    "What is 12 times 11?",
    "How many days are in a leap year?",
    "Define runway in a startup context, one sentence.",
    "Should we raise a priced round or a SAFE given 14 months of runway?",  # -> STRATEGIC, no local answer, expected to no-op past classification
]

N_ROUNDS = 5
PACE_S = 1.0


async def main():
    await load_registry_from_db()
    print(f"CLASSIFIER -> {MODEL_REGISTRY['CLASSIFIER'].provider_name}/{MODEL_REGISTRY['CLASSIFIER'].model}")
    print(f"FACTUAL    -> {MODEL_REGISTRY['FACTUAL'].provider_name}/{MODEL_REGISTRY['FACTUAL'].model}\n")

    crashes = []
    latencies = []
    total = 0

    for round_i in range(N_ROUNDS):
        for query in PROMPTS:
            total += 1
            start = time.time()
            try:
                full = []
                async for chunk in route_query("You are a helpful assistant.", query, max_tokens=100):
                    full.append(chunk)
                model_used = full[0] if full else None
            except Exception as e:
                crashes.append({"round": round_i, "query": query, "error": f"{type(e).__name__}: {e}"})
                print(f"[CRASH] round={round_i} query={query!r} error={e}")
                continue
            latency_ms = (time.time() - start) * 1000
            latencies.append(latency_ms)
            print(f"[OK] round={round_i} model_used={model_used:<22} latency={latency_ms:.0f}ms query={query[:45]!r}")
            await asyncio.sleep(PACE_S)

    print("\n--- Summary ---")
    print(f"total_requests={total}  crashes={len(crashes)}")
    if latencies:
        print(f"latency: min={min(latencies):.0f}ms max={max(latencies):.0f}ms avg={sum(latencies)/len(latencies):.0f}ms")
    if crashes:
        for c in crashes:
            print(f"  CRASH round={c['round']} query={c['query']!r} error={c['error']}")


asyncio.run(main())
