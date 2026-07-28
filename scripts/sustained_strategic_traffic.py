"""
Stage 10 — sustained traffic for STRATEGIC, mixed with CLASSIFIER and
FACTUAL-bound queries via the real route_query()/classify_query() path, so
all three Ollama tiers genuinely swap in and out of VRAM under real
conditions rather than being tested in isolation. Same pattern as
scripts/sustained_factual_traffic.py.

This matters more here than it did for FACTUAL: this host runs Ollama with
OLLAMA_MAX_LOADED_MODELS=1 (see model_provider.py's USE_LOCAL_STRATEGIC
comment) specifically because STRATEGIC's model (qwen2.5:14b-instruct,
~9GB) can't safely coexist with another loaded model on this 12GB card.
That means every tier switch forces a real unload+reload -- this script is
what actually exercises that swap path repeatedly, which is where the
earlier deepseek-r1:8b instability and the qwen2.5:14b/deepseek-r1
mixed-residency crash both surfaced during benchmarking. Watches for
crashes and reload-latency spikes.
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

# Deliberately cycles CLASSIFIER -> STRATEGIC -> CLASSIFIER -> FACTUAL each
# round, forcing a real Ollama model swap between every single call under
# OLLAMA_MAX_LOADED_MODELS=1.
PROMPTS = [
    "What does MRR stand for? One sentence.",  # -> FACTUAL
    "Should we raise a priced round or a SAFE given 14 months of runway?",  # -> STRATEGIC
    "What is 12 times 11?",  # -> FACTUAL
    "Should an early-stage startup build auth in-house or use a third-party provider?",  # -> STRATEGIC
    "How many days are in a leap year?",  # -> FACTUAL
]

N_ROUNDS = 5
PACE_S = 1.0


async def main():
    await load_registry_from_db()
    print(f"CLASSIFIER -> {MODEL_REGISTRY['CLASSIFIER'].provider_name}/{MODEL_REGISTRY['CLASSIFIER'].model}")
    print(f"FACTUAL    -> {MODEL_REGISTRY['FACTUAL'].provider_name}/{MODEL_REGISTRY['FACTUAL'].model}")
    print(f"STRATEGIC  -> {MODEL_REGISTRY['STRATEGIC'].provider_name}/{MODEL_REGISTRY['STRATEGIC'].model}\n")

    crashes = []
    latencies_by_model = {}
    total = 0

    for round_i in range(N_ROUNDS):
        for query in PROMPTS:
            total += 1
            start = time.time()
            try:
                full = []
                async for chunk in route_query("You are a helpful assistant.", query, max_tokens=150):
                    full.append(chunk)
                model_used = full[0] if full else None
                text = "".join(c for c in full[1:] if isinstance(c, str))
            except Exception as e:
                crashes.append({"round": round_i, "query": query, "error": f"{type(e).__name__}: {e}"})
                print(f"[CRASH] round={round_i} query={query!r} error={e}")
                continue
            latency_ms = (time.time() - start) * 1000
            latencies_by_model.setdefault(model_used, []).append(latency_ms)
            degenerate = len(text) > 20 and len(set(text.replace(" ", ""))) <= 2
            tag = "GARBLED" if degenerate else "OK"
            print(f"[{tag}] round={round_i} model_used={model_used:<22} latency={latency_ms:.0f}ms "
                  f"query={query[:45]!r} answer={text[:60]!r}")
            if degenerate:
                crashes.append({"round": round_i, "query": query, "error": f"degenerate output: {text[:80]!r}"})
            await asyncio.sleep(PACE_S)

    print("\n--- Summary ---")
    print(f"total_requests={total}  crashes={len(crashes)}")
    for model, lats in latencies_by_model.items():
        print(f"  {model:<22} n={len(lats)} min={min(lats):.0f}ms max={max(lats):.0f}ms avg={sum(lats)/len(lats):.0f}ms")
    if crashes:
        for c in crashes:
            print(f"  CRASH round={c['round']} query={c['query']!r} error={c['error']}")


asyncio.run(main())
