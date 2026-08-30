"""
Measurable, per-task-type reflection for the agent loop.

Replaces the implicit "no tool_calls ⇒ done" check with concrete criteria
keyed by what kind of work was done. Failures name the specific criterion
so the next plan step can act on it (not a blind retry).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional


_RESEARCH_GOAL_RE = re.compile(
    r"\b("
    r"search|look\s+up|find\s+out|what(?:'s|\s+is)\s+happening|"
    r"latest|news|current|price|market|who\s+is|research|"
    r"according\s+to|sources?"
    r")\b",
    re.IGNORECASE,
)

_FILE_GOAL_RE = re.compile(
    r"\b("
    r"file|document|pdf|docx?|spreadsheet|csv|folder|"
    r"read\s+(?:the\s+)?(?:file|doc)|summarize\s+(?:this|the)\s+|"
    r"what(?:'s|\s+is)\s+in\s+(?:my|the)\s+"
    r")\b",
    re.IGNORECASE,
)

_MEMORY_GOAL_RE = re.compile(
    r"\b("
    r"remember|memory|what\s+did\s+i\s+(?:say|tell|prefer)|"
    r"my\s+preference|did\s+we\s+(?:decide|agree)|"
    r"save\s+(?:that|this)|what\s+do\s+you\s+know\s+about\s+me"
    r")\b",
    re.IGNORECASE,
)

_URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)


@dataclass
class CriterionFailure:
    id: str
    task_type: str
    reason: str


@dataclass
class ReflectResult:
    passed: bool
    task_types: list[str]
    failures: list[CriterionFailure] = field(default_factory=list)
    checked: list[str] = field(default_factory=list)


def classify_task_types(goal: str, tools_used: list[str]) -> list[str]:
    """Return applicable task-type keys for this turn's work."""
    types: list[str] = []
    tools = set(tools_used or [])

    if "web_search" in tools or _RESEARCH_GOAL_RE.search(goal or ""):
        types.append("factual_research")
    if tools & {"read_file", "system_file_read", "list_files", "system_file_list"}:
        types.append("file_based")
    elif _FILE_GOAL_RE.search(goal or ""):
        types.append("file_based")
    if "memory_write" in tools or (
        "memory_read" in tools and _MEMORY_GOAL_RE.search(goal or "")
    ):
        types.append("memory_based")
    elif _MEMORY_GOAL_RE.search(goal or ""):
        types.append("memory_based")

    # De-dupe preserving order
    seen: set[str] = set()
    out: list[str] = []
    for t in types:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def should_run_reflection(goal: str, tools_used: list[str]) -> bool:
    """
    Skip reflection for pure conversational turns with no tools and no
    research/file/memory signal — otherwise every "hey" would fail criteria.
    Ambient step-0 memory_read alone does not force reflection unless the
    goal itself is a typed research/file/memory ask.
    """
    if not classify_task_types(goal, tools_used):
        return False
    non_ambient = [t for t in (tools_used or []) if t != "memory_read"]
    if non_ambient:
        return True
    return bool(classify_task_types(goal, []))


def _obs_blob(observations: dict[str, Any]) -> str:
    parts = []
    for k, v in (observations or {}).items():
        try:
            parts.append(f"{k}:{v!s}")
        except Exception:
            parts.append(str(k))
    return "\n".join(parts).lower()


def _check_factual(
    goal: str,
    answer: str,
    tools_used: list[str],
    observations: dict[str, Any],
) -> list[CriterionFailure]:
    failures: list[CriterionFailure] = []
    checked_answer = (answer or "").strip()
    goal_l = (goal or "").lower()

    # addresses_ask: answer shares some substance with the ask
    g_tokens = {w for w in re.findall(r"[a-z0-9]{4,}", goal_l)}
    a_tokens = {w for w in re.findall(r"[a-z0-9]{4,}", checked_answer.lower())}
    shared = g_tokens & a_tokens
    if len(checked_answer) < 20 or (g_tokens and len(shared) == 0 and len(checked_answer) < 80):
        failures.append(
            CriterionFailure(
                id="addresses_ask",
                task_type="factual_research",
                reason="Answer is empty or does not engage the substance of the ask.",
            )
        )

    needs_external = bool(_RESEARCH_GOAL_RE.search(goal or "")) or "web_search" in tools_used
    if needs_external:
        if "web_search" not in tools_used:
            # Personal/memory-only asks that matched the research regex weakly — allow if memory answered
            if "memory_read" in tools_used and not re.search(
                r"\b(latest|news|price|market|current)\b", goal_l
            ):
                pass
            else:
                failures.append(
                    CriterionFailure(
                        id="sources_present",
                        task_type="factual_research",
                        reason="Ask needs external/current facts but web_search was never called.",
                    )
                )
        else:
            blob = _obs_blob(observations)
            search_obs = observations.get("web_search")
            has_results = False
            if isinstance(search_obs, dict):
                results = search_obs.get("results") or []
                has_results = bool(results) and not search_obs.get("error")
            # Cited somehow: URL in answer, or overlap with search snippet titles/content
            cited = bool(_URL_RE.search(checked_answer))
            if has_results and not cited:
                # Soft: require at least some token overlap with search payload
                search_tokens = set(re.findall(r"[a-z0-9]{5,}", blob))
                if search_tokens and len(a_tokens & search_tokens) < 2:
                    failures.append(
                        CriterionFailure(
                            id="sources_real",
                            task_type="factual_research",
                            reason=(
                                "web_search returned results, but the answer does not "
                                "reference them (no URL and negligible overlap with result text) — "
                                "possible fabrication or ignore-the-search."
                            ),
                        )
                    )
            if isinstance(search_obs, dict) and search_obs.get("error"):
                failures.append(
                    CriterionFailure(
                        id="sources_real",
                        task_type="factual_research",
                        reason=f"web_search failed: {search_obs.get('error')}",
                    )
                )
    return failures


def _check_file(
    answer: str,
    tools_used: list[str],
    observations: dict[str, Any],
) -> list[CriterionFailure]:
    failures: list[CriterionFailure] = []
    read_tools = [t for t in tools_used if t in ("read_file", "system_file_read")]
    list_tools = [t for t in tools_used if t in ("list_files", "system_file_list")]

    if not read_tools and not list_tools:
        failures.append(
            CriterionFailure(
                id="file_was_read",
                task_type="file_based",
                reason="File-based ask, but no list_files/read_file (or system_file_*) tool ran.",
            )
        )
        return failures

    # A listing (especially a failed/timed-out one) is not enough to claim
    # the file's content was read — require an actual read tool for grounding.
    if not read_tools:
        list_errs = []
        for tool in list_tools:
            obs = observations.get(tool)
            if isinstance(obs, dict) and obs.get("error"):
                list_errs.append(f"{tool}: {obs.get('error')}")
        reason = (
            "File-based ask needed file content, but no read_file/system_file_read ran."
        )
        if list_errs:
            reason += " Listing only failed: " + "; ".join(list_errs)
        else:
            reason += " Listing alone does not provide content to summarize."
        failures.append(
            CriterionFailure(
                id="file_was_read",
                task_type="file_based",
                reason=reason,
            )
        )
        return failures

    for tool in read_tools:
        obs = observations.get(tool)
        if isinstance(obs, dict) and obs.get("error"):
            failures.append(
                CriterionFailure(
                    id="file_was_read",
                    task_type="file_based",
                    reason=f"{tool} returned an error: {obs.get('error')}",
                )
            )
            continue
        content = ""
        if isinstance(obs, dict):
            content = str(obs.get("content") or "")
        elif isinstance(obs, str):
            content = obs
        if len(content.strip()) < 20:
            failures.append(
                CriterionFailure(
                    id="file_was_read",
                    task_type="file_based",
                    reason=f"{tool} did not return usable file content.",
                )
            )
            continue
        # summary_grounded: answer must overlap real file tokens
        file_tokens = set(re.findall(r"[a-z0-9]{5,}", content.lower()))
        ans_tokens = set(re.findall(r"[a-z0-9]{5,}", (answer or "").lower()))
        if file_tokens and len(file_tokens & ans_tokens) < 2:
            failures.append(
                CriterionFailure(
                    id="summary_grounded",
                    task_type="file_based",
                    reason=(
                        "Answer does not reference identifiable content from the "
                        "file that was read — likely invented rather than grounded."
                    ),
                )
            )
    return failures


def _check_memory(
    answer: str,
    tools_used: list[str],
    observations: dict[str, Any],
) -> list[CriterionFailure]:
    failures: list[CriterionFailure] = []

    if "memory_write" in tools_used:
        obs = observations.get("memory_write")
        if isinstance(obs, dict) and obs.get("skipped"):
            failures.append(
                CriterionFailure(
                    id="memory_write_confirmed",
                    task_type="memory_based",
                    reason="memory_write was skipped or not approved — durable save did not happen.",
                )
            )
        elif isinstance(obs, dict) and obs.get("error"):
            failures.append(
                CriterionFailure(
                    id="memory_write_confirmed",
                    task_type="memory_based",
                    reason=f"memory_write failed: {obs.get('error')}",
                )
            )
        elif not isinstance(obs, dict) or not (obs.get("text") or obs.get("created_at")):
            # success payload from append_memory_entry has text+created_at
            if not (isinstance(obs, dict) and obs.get("skipped") is False):
                # If observation is the written entry, OK
                if not (isinstance(obs, dict) and "text" in obs):
                    failures.append(
                        CriterionFailure(
                            id="memory_hit_real",
                            task_type="memory_based",
                            reason="memory_write observation does not show a real stored entry.",
                        )
                    )

    if "memory_read" in tools_used:
        obs = observations.get("memory_read")
        if obs is None:
            failures.append(
                CriterionFailure(
                    id="memory_hit_real",
                    task_type="memory_based",
                    reason="memory_read produced no inspectable observation.",
                )
            )
        elif isinstance(obs, list) and len(obs) == 0:
            # Empty memory is a real result — OK if answer admits that
            if not re.search(r"\b(don'?t|do not|no|nothing|empty|haven'?t)\b", (answer or "").lower()):
                failures.append(
                    CriterionFailure(
                        id="memory_hit_real",
                        task_type="memory_based",
                        reason=(
                            "memory_read returned no entries, but the answer does not "
                            "acknowledge the empty store."
                        ),
                    )
                )
        elif isinstance(obs, list) and obs:
            mem_text = " ".join(
                str(e.get("text") or "") for e in obs if isinstance(e, dict)
            ).lower()
            mem_tokens = set(re.findall(r"[a-z0-9]{5,}", mem_text))
            ans_tokens = set(re.findall(r"[a-z0-9]{5,}", (answer or "").lower()))
            if mem_tokens and len(mem_tokens & ans_tokens) < 1:
                failures.append(
                    CriterionFailure(
                        id="memory_hit_real",
                        task_type="memory_based",
                        reason=(
                            "Answer does not reference any real memory entry text "
                            "despite a non-empty memory_read."
                        ),
                    )
                )
    elif _MEMORY_GOAL_RE.search(answer and "" or ""):
        pass

    return failures


def reflect_on_answer(
    goal: str,
    answer: str,
    tools_used: list[str],
    observations: dict[str, Any],
) -> ReflectResult:
    task_types = classify_task_types(goal, tools_used)
    if not task_types:
        return ReflectResult(passed=True, task_types=[], checked=[])

    failures: list[CriterionFailure] = []
    checked: list[str] = []

    if "factual_research" in task_types:
        checked.extend(["addresses_ask", "sources_present", "sources_real"])
        failures.extend(_check_factual(goal, answer, tools_used, observations))
    if "file_based" in task_types:
        checked.extend(["file_was_read", "summary_grounded"])
        failures.extend(_check_file(answer, tools_used, observations))
    if "memory_based" in task_types:
        checked.extend(["memory_hit_real", "memory_write_confirmed"])
        failures.extend(_check_memory(answer, tools_used, observations))

    return ReflectResult(
        passed=len(failures) == 0,
        task_types=task_types,
        failures=failures,
        checked=checked,
    )


def format_reflect_observation(result: ReflectResult) -> dict[str, Any]:
    return {
        "passed": result.passed,
        "task_types": result.task_types,
        "checked_criteria": result.checked,
        "failed_criteria": [
            {"id": f.id, "task_type": f.task_type, "reason": f.reason}
            for f in result.failures
        ],
    }


def format_reflect_replan_message(result: ReflectResult) -> str:
    """Concrete failure text the planner must act on — not 'try again'."""
    lines = [
        "[reflect result — criteria not met; re-plan using the specific failures below, "
        "do not repeat the same approach that failed]:",
    ]
    for f in result.failures:
        lines.append(f"- ({f.task_type}/{f.id}) {f.reason}")
    lines.append(
        "Call the tool(s) needed to fix the named failures, then answer. "
        "If a failure cannot be fixed with available tools, say so plainly."
    )
    return "\n".join(lines)
