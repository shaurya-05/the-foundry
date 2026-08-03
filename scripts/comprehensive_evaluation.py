"""
Comprehensive end-to-end evaluation of FOUND3RY's AI routing stack at its
current state (CLASSIFIER/FACTUAL/STRATEGIC on local Ollama, RESEARCH/
DOCUMENT on unconfigured closed APIs). Runs real prompts through the real
route_query()/classify_query() path -- not isolated provider calls -- so
results reflect what a real user actually experiences, including cross-
provider fallback behavior when RESEARCH/DOCUMENT aren't configured.

40 prompts across 4 categories (10 each): FACTUAL, STRATEGIC, RESEARCH,
DOCUMENT. Measures:
  - Classification accuracy (does CLASSIFIER route to the expected tier)
  - Answer accuracy where scorable (FACTUAL: keyword match; STRATEGIC:
    concept-coverage + commits-to-a-position, same rubrics as the
    per-tier benchmark scripts)
  - Latency per request (classify phase + answer phase, total)
  - GPU/VRAM sampled via nvidia-smi at intervals throughout the run
"""
import asyncio
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
os.environ.setdefault("DATABASE_URL", "postgresql://foundry:foundry_secret@localhost:5432/foundry_db")
os.environ.setdefault("OLLAMA_API_KEY", "ollama-local")

from app.services.ai_router import classify_query
from app.services.model_provider import MODEL_REGISTRY, load_registry_from_db

HEDGE_OPENERS = (
    "it depends", "that depends", "there's no one-size-fits-all",
    "there is no one-size-fits-all", "it's hard to say", "well, it depends",
)

FACTUAL_SET = [
    {"query": "What is the capital of Japan?", "keywords": ["tokyo"]},
    {"query": "What is 25 times 4?", "keywords": ["100"]},
    {"query": "How many days are in a leap year?", "keywords": ["366"]},
    {"query": "What does ARR stand for?", "keywords": ["annual recurring revenue"]},
    {"query": "What is a cap table, one sentence?", "keywords": ["capitalization", "equity", "ownership", "shares"]},
    {"query": "Define churn rate in a SaaS context, one sentence.", "keywords": ["cancel", "leave", "percentage", "customers"]},
    {"query": "What year did the first iPhone launch?", "keywords": ["2007"]},
    {"query": "What is the boiling point of water in Celsius?", "keywords": ["100"]},
    {"query": "How many continents are there?", "keywords": ["seven", "7"]},
    {"query": "What does B2B stand for?", "keywords": ["business-to-business", "business to business"]},
]

STRATEGIC_SET = [
    {"query": "Should we raise a Series A now or wait 6 months? Give a clear recommendation.",
     "concepts": [["runway", "burn"], ["valuation", "traction", "metrics"], ["dilution", "risk"]]},
    {"query": "Our churn rate just doubled. What should we investigate first? Give a clear recommendation.",
     "concepts": [["onboarding", "support", "product"], ["cohort", "segment"], ["pricing", "competitor"]]},
    {"query": "Should we hire a VP of Sales before we have product-market fit? Give a clear recommendation.",
     "concepts": [["product-market fit", "pmf"], ["cost", "burn", "salary"], ["founder-led", "premature"]]},
    {"query": "A competitor just got acquired. How should we react? Give a clear recommendation.",
     "concepts": [["customers", "displaced", "opportunity"], ["messaging", "positioning"], ["risk", "wait"]]},
    {"query": "Should we open source part of our product? Give a clear recommendation.",
     "concepts": [["adoption", "community", "distribution"], ["competitive advantage", "moat"], ["revenue", "monetiz"]]},
    {"query": "We're deciding between two co-founder candidates for a technical role. How do we choose? Give a clear recommendation.",
     "concepts": [["equity", "vesting"], ["trust", "track record", "trial"], ["skills", "complementary"]]},
    {"query": "Should we bootstrap or raise venture capital? Give a clear recommendation.",
     "concepts": [["control", "dilution"], ["growth", "speed", "capital"], ["risk", "runway"]]},
    {"query": "Our best engineer wants to leave. What do we do? Give a clear recommendation.",
     "concepts": [["retention", "counter-offer", "equity"], ["knowledge transfer", "handoff"], ["root cause", "why"]]},
    {"query": "Should we expand internationally or double down domestically? Give a clear recommendation.",
     "concepts": [["market size", "demand"], ["operational complexity", "localization"], ["resources", "focus"]]},
    {"query": "A big customer wants exclusivity in their contract. Should we agree? Give a clear recommendation.",
     "concepts": [["revenue concentration", "dependency"], ["future customers", "market"], ["negotiate", "carve-out"]]},
]

RESEARCH_SET = [
    "What's the latest funding round announced by OpenAI?",
    "What are today's top technology news headlines?",
    "What is the current Federal Reserve interest rate?",
    "Who stood out at the most recent Y Combinator Demo Day?",
    "What's the current stock price of NVIDIA?",
    "What are the latest updates to GDPR compliance rules?",
    "What happened in the AI industry this week?",
    "What's the current unemployment rate in the United States?",
]

DOCUMENT_SET = [
    "Summarize the key differences between our last three investor updates.",
    "Cross-reference our product roadmap doc with the latest customer feedback doc.",
    "Given this 50-page contract, what are the indemnification clauses?",
    "Compare our Q1 and Q3 board decks and highlight strategic shifts.",
    "Summarize this codebase's architecture from the README and docs folder.",
    "What are the main themes across all our user interview transcripts?",
    "Given our full legal terms document, what obligations do we have to EU customers?",
    "Synthesize insights from our last 12 months of support tickets.",
]

SYSTEM = "You are a helpful startup assistant. Be direct and concise."


def gpu_snapshot():
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        used, total, util = [x.strip() for x in out.split(",")]
        return {"used_mib": int(used), "total_mib": int(total), "util_pct": int(util)}
    except Exception:
        return None


def score_factual(answer: str, keywords: list) -> bool:
    low = answer.lower()
    return any(k.lower() in low for k in keywords)


def score_strategic(answer: str, concepts: list) -> int:
    low = answer.lower()
    concept_hits = sum(1 for group in concepts if any(kw in low for kw in group))
    if concept_hits == 0:
        return 1
    hedges = any(low.strip().startswith(h) for h in HEDGE_OPENERS)
    word_count = len(answer.split())
    well_sized = 20 <= word_count <= 500
    if hedges or not well_sized:
        return 2
    return 5 if concept_hits >= 2 else 4


async def run_one(query: str, expected_tier: str):
    gpu_before = gpu_snapshot()
    t0 = time.time()
    actual_label = await classify_query(query)
    t1 = time.time()
    classify_ms = (t1 - t0) * 1000

    provider = MODEL_REGISTRY.get(actual_label)
    answer = ""
    answer_ms = None
    error = None
    real_model_used = None
    if provider is not None:
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": query}]
        t2 = time.time()
        if provider.is_configured():
            async for chunk in provider.complete(messages, stream=False, max_tokens=300, timeout_s=60.0):
                if chunk.error:
                    error = chunk.error
                if chunk.content:
                    answer += chunk.content
                if chunk.is_final:
                    real_model_used = chunk.model_used
        else:
            # Not configured locally -- mirror call_with_resilience's
            # cross-provider fallback so this reflects what a real user
            # would actually get, not a synthetic "unconfigured" no-op.
            from app.services.model_provider import FALLBACK_ORDER
            for fb_label in FALLBACK_ORDER:
                fb_provider = MODEL_REGISTRY.get(fb_label)
                if fb_provider and fb_provider.is_configured():
                    async for chunk in fb_provider.complete(messages, stream=False, max_tokens=300, timeout_s=60.0):
                        if chunk.error:
                            error = chunk.error
                        if chunk.content:
                            answer += chunk.content
                        if chunk.is_final:
                            real_model_used = chunk.model_used
                    break
            else:
                error = "no configured provider in fallback chain"
        answer_ms = (time.time() - t2) * 1000

    gpu_after = gpu_snapshot()
    return {
        "query": query, "expected_tier": expected_tier, "actual_label": actual_label,
        "classify_ms": classify_ms, "answer_ms": answer_ms, "answer": answer,
        "error": error, "real_model_used": real_model_used,
        "gpu_before": gpu_before, "gpu_after": gpu_after,
    }


async def main():
    await load_registry_from_db()
    print("=== Registry ===")
    for label in ("CLASSIFIER", "FACTUAL", "STRATEGIC", "RESEARCH", "DOCUMENT"):
        p = MODEL_REGISTRY.get(label)
        configured = p.is_configured() if p else False
        print(f"  {label:10} provider={p.provider_name if p else None!r:14} model={p.model if p else None!r:28} configured={configured}")
    print()

    all_results = []

    print("=== FACTUAL (10 prompts) ===")
    for item in FACTUAL_SET:
        r = await run_one(item["query"], "FACTUAL")
        r["correct"] = r["actual_label"] == "FACTUAL" and score_factual(r["answer"], item["keywords"])
        r["classified_correctly"] = r["actual_label"] == "FACTUAL"
        all_results.append(r)
        tag = "OK  " if r["correct"] else "MISS"
        print(f"[{tag}] label={r['actual_label']:10} classify={r['classify_ms']:6.0f}ms answer={(r['answer_ms'] or 0):6.0f}ms "
              f"query={item['query'][:45]!r} answer={r['answer'][:60]!r}")

    print("\n=== STRATEGIC (10 prompts) ===")
    for item in STRATEGIC_SET:
        r = await run_one(item["query"], "STRATEGIC")
        r["score"] = score_strategic(r["answer"], item["concepts"]) if r["actual_label"] == "STRATEGIC" else 0
        r["correct"] = r["actual_label"] == "STRATEGIC" and r["score"] >= 4
        r["classified_correctly"] = r["actual_label"] == "STRATEGIC"
        all_results.append(r)
        tag = "OK  " if r["correct"] else "MISS"
        print(f"[{tag}] label={r['actual_label']:10} score={r['score']}/5 classify={r['classify_ms']:6.0f}ms answer={(r['answer_ms'] or 0):6.0f}ms "
              f"query={item['query'][:45]!r} answer={r['answer'][:60]!r}")

    print("\n=== RESEARCH (8 prompts, classification + fallback behavior) ===")
    for query in RESEARCH_SET:
        r = await run_one(query, "RESEARCH")
        r["classified_correctly"] = r["actual_label"] == "RESEARCH"
        r["correct"] = r["classified_correctly"]  # no answer-quality rubric for RESEARCH
        all_results.append(r)
        tag = "OK  " if r["classified_correctly"] else "MISS"
        fb_note = f" (fell back to {r['real_model_used']})" if r["real_model_used"] else ""
        print(f"[{tag}] label={r['actual_label']:10}{fb_note} classify={r['classify_ms']:6.0f}ms answer={(r['answer_ms'] or 0):6.0f}ms "
              f"query={query[:45]!r} answer={r['answer'][:60]!r} error={r['error']}")

    print("\n=== DOCUMENT (8 prompts, classification + fallback behavior) ===")
    for query in DOCUMENT_SET:
        r = await run_one(query, "DOCUMENT")
        r["classified_correctly"] = r["actual_label"] == "DOCUMENT"
        r["correct"] = r["classified_correctly"]
        all_results.append(r)
        tag = "OK  " if r["classified_correctly"] else "MISS"
        fb_note = f" (fell back to {r['real_model_used']})" if r["real_model_used"] else ""
        print(f"[{tag}] label={r['actual_label']:10}{fb_note} classify={r['classify_ms']:6.0f}ms answer={(r['answer_ms'] or 0):6.0f}ms "
              f"query={query[:45]!r} answer={r['answer'][:60]!r} error={r['error']}")

    # --- Final report ---
    n = len(all_results)
    print(f"\n\n=== FINAL REPORT ({n} prompts total) ===\n")

    print("--- Classification accuracy (did CLASSIFIER route correctly) ---")
    for tier, subset in [("FACTUAL", FACTUAL_SET), ("STRATEGIC", STRATEGIC_SET),
                          ("RESEARCH", RESEARCH_SET), ("DOCUMENT", DOCUMENT_SET)]:
        rows = [r for r in all_results if r["expected_tier"] == tier]
        correct = sum(1 for r in rows if r["classified_correctly"])
        print(f"  {tier:10} {correct}/{len(rows)} = {100*correct/len(rows):.0f}%")
    total_classified_correct = sum(1 for r in all_results if r["classified_correctly"])
    print(f"  {'OVERALL':10} {total_classified_correct}/{n} = {100*total_classified_correct/n:.0f}%\n")

    print("--- Answer accuracy where scorable (FACTUAL keyword match, STRATEGIC score>=4/5) ---")
    fact_rows = [r for r in all_results if r["expected_tier"] == "FACTUAL"]
    strat_rows = [r for r in all_results if r["expected_tier"] == "STRATEGIC"]
    fact_correct = sum(1 for r in fact_rows if r["correct"])
    strat_correct = sum(1 for r in strat_rows if r["correct"])
    print(f"  FACTUAL    {fact_correct}/{len(fact_rows)} = {100*fact_correct/len(fact_rows):.0f}%")
    print(f"  STRATEGIC  {strat_correct}/{len(strat_rows)} = {100*strat_correct/len(strat_rows):.0f}%")
    scorable = fact_rows + strat_rows
    scorable_correct = fact_correct + strat_correct
    print(f"  COMBINED   {scorable_correct}/{len(scorable)} = {100*scorable_correct/len(scorable):.0f}%\n")

    print("--- Latency (total = classify_ms + answer_ms) ---")
    for tier in ("FACTUAL", "STRATEGIC", "RESEARCH", "DOCUMENT"):
        rows = [r for r in all_results if r["expected_tier"] == tier and r["answer_ms"] is not None]
        if not rows:
            continue
        totals = [r["classify_ms"] + r["answer_ms"] for r in rows]
        totals.sort()
        p50 = totals[len(totals)//2]
        print(f"  {tier:10} n={len(rows):2} avg={sum(totals)/len(totals):7.0f}ms  min={min(totals):7.0f}ms  "
              f"p50={p50:7.0f}ms  max={max(totals):7.0f}ms")

    print("\n--- GPU/VRAM usage observed during run ---")
    all_used = [r["gpu_after"]["used_mib"] for r in all_results if r["gpu_after"]]
    all_util = [r["gpu_after"]["util_pct"] for r in all_results if r["gpu_after"]]
    if all_used:
        total_mib = all_results[0]["gpu_after"]["total_mib"]
        print(f"  card total: {total_mib} MiB")
        print(f"  VRAM used:  min={min(all_used)} MiB  max={max(all_used)} MiB  avg={sum(all_used)/len(all_used):.0f} MiB")
        print(f"  utilization: min={min(all_util)}%  max={max(all_util)}%  avg={sum(all_util)/len(all_util):.0f}%")
        print(f"  peak VRAM as % of card: {100*max(all_used)/total_mib:.0f}%")

    errors = [r for r in all_results if r["error"]]
    if errors:
        print(f"\n--- Errors encountered ({len(errors)}) ---")
        for r in errors:
            print(f"  [{r['expected_tier']}] {r['query'][:50]!r} -> {r['error']}")


asyncio.run(main())
