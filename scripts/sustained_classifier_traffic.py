"""
Stage 7 — sustained CLASSIFIER traffic against local Ollama. Watches for:
    - crashes / unhandled exceptions per request
    - unexpected model reloads (a reload shows up as a latency spike
      back toward the ~3s cold-load time seen in Stage 6, versus the
      ~140ms warm baseline)
    - the FACTUAL/DOCUMENT confusion pattern flagged after Stage 6
      (a document-summarization-style query got classified FACTUAL
      instead of DOCUMENT). Every recurrence is logged explicitly by
      name, not folded into an aggregate accuracy number — this is a
      specific weak boundary that matters for the DOCUMENT migration,
      not general noise to average away.
"""
import asyncio
import os
import time
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
os.environ.setdefault("DATABASE_URL", "postgresql://foundry:foundry_secret@localhost:5432/foundry_db")
os.environ.setdefault("OLLAMA_API_KEY", "ollama-local")

from app.services.ai_router import classify_query
from app.services.model_provider import MODEL_REGISTRY, load_registry_from_db

# Rotation: the 8 Stage 6 prompts plus 4 new DOCUMENT-flavored variants
# specifically targeting the flagged boundary, so we get repeated,
# independent probes of that failure mode rather than just one sample.
PROMPTS = [
    ("Define runway in one sentence.", "FACTUAL"),
    ("What is a term sheet? Answer in one sentence.", "FACTUAL"),
    ("How many days are in a leap year?", "FACTUAL"),
    ("Should we raise a priced round or a SAFE for our seed, given we have 14 months of runway and one competitor just raised $8M?", "STRATEGIC"),
    ("We're deciding whether to sunset our freemium tier entirely or gate it further. Walk through the tradeoffs.", "STRATEGIC"),
    ("What's the current market size for vertical SaaS in the audit/compliance space in North America?", "RESEARCH"),
    ("What are competitors charging right now for API-based fraud detection tools?", "RESEARCH"),
    ("Summarize the key risks called out in this 40-page due diligence report.", "DOCUMENT"),
    ("Cross-reference our Q3 board deck against the term sheet and flag any inconsistencies.", "DOCUMENT"),
    ("Review this pitch deck and pull out the three weakest slides.", "DOCUMENT"),
    ("I've uploaded our cap table spreadsheet — summarize the dilution across rounds.", "DOCUMENT"),
    ("Analyze the attached competitor teardown doc and summarize its main claims.", "DOCUMENT"),
]

N_ROUNDS = 4  # 4 * 12 = 48 requests
PACE_S = 1.5


async def main():
    await load_registry_from_db()
    provider = MODEL_REGISTRY["CLASSIFIER"]
    print(f"CLASSIFIER -> {provider.provider_name}/{provider.model}\n")

    crashes = []
    confusion_hits = []  # explicit: DOCUMENT expected, FACTUAL returned
    latencies = []
    total = 0

    for round_i in range(N_ROUNDS):
        for query, expected in PROMPTS:
            total += 1
            start = time.time()
            try:
                label = await classify_query(query)
            except Exception as e:
                crashes.append({"round": round_i, "query": query, "error": f"{type(e).__name__}: {e}"})
                print(f"[CRASH] round={round_i} query={query!r} error={e}")
                continue
            latency_ms = (time.time() - start) * 1000
            latencies.append(latency_ms)

            tag = "OK  " if label == expected else "MISS"
            print(f"[{tag}] round={round_i} expected={expected:<10} got={label:<10} "
                  f"latency={latency_ms:.0f}ms  query={query[:60]!r}")

            if expected == "DOCUMENT" and label == "FACTUAL":
                confusion_hits.append({
                    "round": round_i, "query": query, "expected": expected,
                    "got": label, "latency_ms": round(latency_ms, 1),
                })
                print(f"  >>> FACTUAL/DOCUMENT CONFUSION recurrence #{len(confusion_hits)}: {query!r}")

            await asyncio.sleep(PACE_S)

    print("\n--- Sustained traffic summary ---")
    print(f"total_requests={total}  crashes={len(crashes)}")
    if latencies:
        print(f"latency: min={min(latencies):.0f}ms max={max(latencies):.0f}ms "
              f"avg={sum(latencies)/len(latencies):.0f}ms")
        reload_suspects = [l for l in latencies[1:] if l > 1000]  # after first (expected cold-load) call
        print(f"latency spikes >1000ms after the first call (possible reload): {len(reload_suspects)} "
              f"{reload_suspects if reload_suspects else ''}")
    print(f"\nFACTUAL/DOCUMENT confusion: {len(confusion_hits)} recurrence(s) out of "
          f"{sum(1 for _, e in PROMPTS if e == 'DOCUMENT') * N_ROUNDS} DOCUMENT-expected probes")
    for h in confusion_hits:
        print(f"  round={h['round']} query={h['query']!r}")
    if crashes:
        print(f"\nCRASHES ({len(crashes)}):")
        for c in crashes:
            print(f"  round={c['round']} query={c['query']!r} error={c['error']}")


asyncio.run(main())
