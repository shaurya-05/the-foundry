"""
Search-before-build — agent loop refinement.

Before the planner generates new material for a "build/draft/create" goal,
scan memory, this-thread history, and the prior-chat digest for candidates
that may already answer the ask. If any clear, surface them to the user as
options and stop — do not silently rebuild.

This is a deterministic step (like memory_read at iteration 0), not a
separate subsystem.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional

# Goals that imply producing new material rather than a quick factual lookup.
_BUILD_GOAL_RE = re.compile(
    r"\b("
    r"draft|write|put\s+together|create|build|compose|prepare|generate|"
    r"outline|proposal|memo|brief(?:ing)?|deck|investor\s+update|"
    r"come\s+up\s+with|make\s+(?:me\s+|us\s+|an?\s+|the\s+)?|"
    r"something\s+for|put\s+something\s+together"
    r")\b",
    re.IGNORECASE,
)

# Explicit "I want something new anyway" — skip the reuse gate.
_FRESH_BUILD_RE = re.compile(
    r"\b("
    r"from\s+scratch|something\s+new|build\s+(?:a\s+)?new|"
    r"start\s+over|fresh\s+(?:draft|version|one)|"
    r"ignore\s+(?:the\s+)?(?:previous|prior|existing)|"
    r"don'?t\s+reuse|new\s+version\s+anyway"
    r")\b",
    re.IGNORECASE,
)

_STOPWORDS = frozenset(
    """
    that this with from have been were will would could should about into
    your their there these those them then than what when where which while
    just like some more most only also over such very much many make made
    want need help please something anything everything nothing for the and
    """.split()
)


@dataclass
class ExistingCandidate:
    source: str  # "memory" | "thread" | "prior_chat"
    excerpt: str
    score: float
    label: str


def looks_like_build_goal(goal: str) -> bool:
    return bool(_BUILD_GOAL_RE.search(goal or ""))


def user_wants_fresh_build(goal: str) -> bool:
    return bool(_FRESH_BUILD_RE.search(goal or ""))


def significant_tokens(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]{4,}", (text or "").lower())
    return {w for w in words if w not in _STOPWORDS}


def _score_overlap(goal_tokens: set[str], text: str) -> float:
    if not goal_tokens:
        return 0.0
    other = significant_tokens(text)
    if not other:
        return 0.0
    shared = goal_tokens & other
    if len(shared) < 2 and not any(len(t) >= 8 for t in shared):
        return 0.0
    return len(shared) / max(len(goal_tokens), 1)


def _clip(text: str, n: int = 220) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if len(text) <= n:
        return text
    return text[: n - 1].rstrip() + "…"


def find_existing_candidates(
    goal: str,
    memory_entries: Any,
    history: Optional[list[dict]] = None,
    cross_thread_context: Optional[str] = None,
    *,
    max_candidates: int = 5,
    min_score: float = 0.18,
) -> list[ExistingCandidate]:
    """
    Rank reusable material that may already satisfy a build-style goal.
    Pure heuristics — no model call — so the step is cheap and traceable.
    """
    goal_tokens = significant_tokens(goal)
    if not goal_tokens:
        return []

    scored: list[ExistingCandidate] = []

    if isinstance(memory_entries, list):
        for entry in memory_entries:
            if not isinstance(entry, dict):
                continue
            text = (entry.get("text") or "").strip()
            if len(text) < 40:
                continue
            score = _score_overlap(goal_tokens, text)
            if score >= min_score:
                src = entry.get("source") or "memory"
                scored.append(
                    ExistingCandidate(
                        source="memory",
                        excerpt=_clip(text),
                        score=score,
                        label=f"Memory · {src}",
                    )
                )

    for turn in history or []:
        if turn.get("role") != "assistant":
            continue
        content = (turn.get("content") or "").strip()
        if len(content) < 120:
            continue
        score = _score_overlap(goal_tokens, content)
        # Prefer substantial prior drafts in-thread
        if score >= min_score:
            scored.append(
                ExistingCandidate(
                    source="thread",
                    excerpt=_clip(content),
                    score=score + 0.05,
                    label="This chat · prior reply",
                )
            )

    digest = (cross_thread_context or "").strip()
    if digest:
        # Digest is often multi-thread; score whole + per paragraph.
        chunks = [c.strip() for c in re.split(r"\n{2,}", digest) if len(c.strip()) >= 60]
        if not chunks:
            chunks = [digest]
        for chunk in chunks[:12]:
            score = _score_overlap(goal_tokens, chunk)
            if score >= min_score:
                scored.append(
                    ExistingCandidate(
                        source="prior_chat",
                        excerpt=_clip(chunk),
                        score=score,
                        label="Prior chat digest",
                    )
                )

    scored.sort(key=lambda c: c.score, reverse=True)
    # De-dupe near-identical excerpts
    out: list[ExistingCandidate] = []
    seen: set[str] = set()
    for c in scored:
        key = c.excerpt[:80].lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
        if len(out) >= max_candidates:
            break
    return out


def format_candidates_for_user(goal: str, candidates: list[ExistingCandidate]) -> str:
    lines = [
        "I found existing material that may already cover this — "
        "pick one to reuse, or tell me to build something new:",
        "",
    ]
    for i, c in enumerate(candidates, 1):
        lines.append(f"{i}. [{c.label}] {c.excerpt}")
        lines.append("")
    lines.append(
        "Reply with a number, paste which one you want, or say "
        "“build something new” if you’d rather start fresh."
    )
    return "\n".join(lines).strip()


def search_before_build_payload(
    goal: str,
    candidates: list[ExistingCandidate],
) -> dict[str, Any]:
    return {
        "goal": goal,
        "action": "surface_to_user" if candidates else "continue_to_build",
        "candidate_count": len(candidates),
        "candidates": [
            {
                "source": c.source,
                "label": c.label,
                "excerpt": c.excerpt,
                "score": round(c.score, 3),
            }
            for c in candidates
        ],
    }
