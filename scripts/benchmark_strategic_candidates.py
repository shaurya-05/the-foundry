"""
Stage 10 — decide between deepseek-r1:8b and qwen2.5:14b-instruct for the
STRATEGIC tier by actually benchmarking both, not assuming. Uses the real
OpenAICompatibleProvider class against local Ollama for each candidate,
independent of MODEL_REGISTRY (no wiring decision made yet). Same pattern
as scripts/benchmark_factual_candidates.py.

STRATEGIC is the hardest-reasoning tier (multi-step reasoning, business-model
critique, ambiguous judgment calls) — unlike FACTUAL, answers aren't reducible
to a single objectively-correct fact. Keeping the "simple 1-5 rubric" house
style anyway: each prompt has a small set of expected-concept groups (a real,
substantive answer would naturally touch several), scored by keyword-group
match plus two structural checks — does it commit to a position instead of
pure hedging, and is the length in a reasonable band (too short = no real
reasoning; too long = rambling, notably a risk for reasoning models that leak
chain-of-thought into the visible answer).

deepseek-r1 models emit reasoning content. Ollama's OpenAI-compat endpoint
returns it in a separate `reasoning` field on the message, not inlined
`<think>` tags in `content` (confirmed by direct curl against
/v1/chat/completions) -- so provider.complete()'s plain `content` read
already gets the clean answer, no stripping needed. Reasoning length is
still reported for visibility into per-call cost.

Candidates are run in fully separate processes back-to-back with an
explicit `ollama stop` between them (see run_strategic_benchmark.sh-style
sequencing below via ONLY_MODEL env var) -- an earlier combined run hit a
transient CUDA error from having deepseek-r1:8b (5.5GB) and
qwen2.5:14b-instruct (~9GB) both resident/thrashing on a 12GB card at once,
which produced garbled output before the crash. Isolating candidates
avoids that entirely and gives a fair per-model reading.

Rubric (1-5) per answer:
    5 — concept_hits >= 2, commits to a position, reasonable length
    4 — concept_hits >= 1, commits to a position
    2 — concept_hits >= 1 but hedges with no follow-through, or badly sized
    1 — no expected concepts present
"""
import asyncio
import os
import statistics
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
os.environ.setdefault("OLLAMA_API_KEY", "ollama-local")

from app.services.model_provider import OpenAICompatibleProvider

HEDGE_OPENERS = (
    "it depends", "that depends", "there's no one-size-fits-all",
    "there is no one-size-fits-all", "it's hard to say", "well, it depends",
)

# Run one candidate per process (ONLY_MODEL=<name>) so a heavy model isn't
# resident in VRAM while another is being benchmarked -- see module
# docstring re: the CUDA instability hit when both were loaded at once.
_only = os.getenv("ONLY_MODEL")

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

CANDIDATES = [_only] if _only else ["deepseek-r1:8b", "qwen2.5:14b-instruct"]

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
        async for chunk in provider.complete(messages, stream=False, max_tokens=700, timeout_s=90.0):
            if chunk.error:
                error = chunk.error
            if chunk.content:
                raw_chunks.append(chunk.content)
            if chunk.is_final:
                latency_ms = chunk.latency_ms
        answer = "".join(raw_chunks)
        s = 1 if error else score(answer, item["concepts"])
        results.append({
            "query": item["query"], "answer": answer, "score": s,
            "latency_ms": round(latency_ms or 0, 1), "error": error,
        })
        tag = "OK  " if s >= 4 else "WEAK" if s > 1 else "MISS"
        print(f"  [{tag}] score={s}/5 latency={results[-1]['latency_ms']}ms "
              f"query={item['query'][:50]!r} answer={answer[:70]!r}")

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
        print(f"{s['model']:<28} avg_score={s['avg_score']}/5  avg_latency_ms={s['avg_latency_ms']}")

    if len(summaries) > 1:
        winner = max(summaries, key=lambda s: (s["avg_score"], -s["avg_latency_ms"]))
        print(f"\nWinner (highest avg_score, tie-break lower latency): {winner['model']}")


asyncio.run(main())
