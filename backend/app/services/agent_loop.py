"""
Agent loop — Phase 3, Stage 4. Plan -> act -> observe -> reflect, capped.

Explicitly NOT wired to fire automatically on any message shape — the
caller (copilot.py) only invokes run_agent_loop() when the client sends
agent_mode=true. Per the Phase 3 brief's own constraint: "This phase does
not include proactive/unprompted behavior" -- detecting "this message is
secretly a goal" is a classification problem of its own, and an explicit
opt-in is the safer, correct-scope choice for this pass.

Shape: one continuous tool-calling conversation with the STRATEGIC-tier
model (the reasoning tier), structured as a ReAct-style loop --
"planning" and "reflecting" aren't separate model calls, they're the same
call: the model either responds with tool_calls (decided more work is
needed -- act) or with plain text (decided the goal is met -- done). What
makes this legible as plan/act/observe/reflect rather than an opaque
black box is that EVERY step yields a structured trace event, not just
the final answer -- see the docstring on run_agent_loop for the event
shapes copilot.py forwards to the frontend.

memory_read is called deterministically as step zero, before the model
sees anything else -- not left to the model's discretion, since the
brief requires the planner to consult memory first, not "usually" do so.

memory_write is confirmation-gated unconditionally, regardless of the
`source` the model claims -- reuses the exact same async_frontend
round-trip primitive as file-access tools do, treating "ask the user for
approval" as just another frontend-mediated pause point. The model's own
claimed source (user_stated vs agent_inferred) is surfaced to the user as
context for their decision, not trusted as an automatic bypass -- a model
could mislabel an inferred fact as user_stated to skip a gate, and this
loop's primary use case (open-ended goals) means most writes it decides
to make are agent-inferred in spirit even when mislabeled.
"""
import json
import re
import time
from typing import Any, AsyncIterator, Optional

import structlog

from app.services.agent_tools import (
    TOOL_REGISTRY, ToolContext, await_frontend_response, create_pending_call,
    tool_definitions_for_planner,
)
from app.services.model_provider import MODEL_REGISTRY

log = structlog.get_logger()

# Small models occasionally write a tool call out as plain text instead of
# using the wire format's structured tool_calls field -- observed directly
# against qwen2.5:7b-instruct, in two distinct shapes so far (roughly 1 in
# 3 on some prompts):
#   1. noise tokens followed by a well-formed {"name": ..., "arguments":
#      {...}} blob, e.g. "søker {\"name\": \"web_search\", \"arguments\":
#      {\"query\": ...}}"
#   2. the bare tool name directly followed by its arguments object with
#      no wrapper at all, e.g. 'memory_write {"text": "...", "source":
#      "user_stated"}' -- seen on memory_write specifically, which would
#      otherwise silently break "remembers the conversation" rather than
#      just a lookup tool.
# Every real tool in TOOL_REGISTRY takes flat (non-nested) arguments, so a
# non-nested-brace match is sufficient for both shapes, not a
# simplification that loses real cases.
_GARBLED_WRAPPED_RE = re.compile(
    r'\{\s*"name"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*,\s*"arguments"\s*:\s*(\{[^{}]*\})\s*\}',
    re.DOTALL,
)


def _recover_garbled_tool_call(text: str) -> Optional[list[dict[str, Any]]]:
    """
    Detect either garbled-tool-call-as-text shape described above and
    recover a real tool call from it, rather than letting the gibberish
    reach the user as a "final answer" -- which is what happens upstream
    if this returns None and tool_calls stays empty.
    """
    match = _GARBLED_WRAPPED_RE.search(text)
    if match:
        name, args_json = match.group(1), match.group(2)
        if name in TOOL_REGISTRY:
            try:
                json.loads(args_json)
                return [{"id": "recovered-0", "name": name, "arguments": args_json}]
            except json.JSONDecodeError:
                pass

    if TOOL_REGISTRY:
        names_pattern = "|".join(re.escape(n) for n in TOOL_REGISTRY)
        bare_re = re.compile(rf'\b({names_pattern})\b\s*(\{{[^{{}}]*\}})', re.DOTALL)
        match = bare_re.search(text)
        if match:
            name, args_json = match.group(1), match.group(2)
            try:
                json.loads(args_json)
                return [{"id": "recovered-0", "name": name, "arguments": args_json}]
            except json.JSONDecodeError:
                return None
    return None

MAX_ITERATIONS = 8
# FACTUAL's qwen2.5:7b-instruct, not STRATEGIC's 14b -- H3RO's primary
# surface is now voice-first, live back-and-forth conversation (agent_mode
# defaults to true in ForgeCopilot.tsx), where every turn pays this
# model's latency before H3RO can start speaking. Measured directly
# against the real running Ollama instance, same prompt, isolated from
# pipeline overhead: qwen2.5:14b-instruct took 11.74s for a trivial
# "hey what's up", qwen2.5:7b-instruct took 0.71s for the identical
# prompt -- and 7b still emits correct tool_calls when a query genuinely
# needs one (verified with a real web-search-worthy query). 14b remains
# available as STRATEGIC for anything that explicitly wants deeper
# reasoning; this loop's default consumer no longer does.
PLANNER_LABEL = "FACTUAL"
CONFIRM_TIMEOUT_S = 60.0  # a human deciding yes/no needs longer than a file read

AGENT_SYSTEM_PROMPT = """You are H3RO (pronounced "hero") — an autonomous collaborating cofound3r working with the founder in an ongoing conversation. Work step by step using the tools available to you.

You have:
- Conversation history for this thread (already in the messages) — use it; do not ask the founder to repeat themselves.
- Prior-chat digest (when present) summarizing other H3RO threads — treat it as shared continuity so a new chat can pick up mid-stream.
- Durable memory (memory_read is provided below) for cross-session facts, uploads/references mentioned before, and conversation digests.
- Local files (list_files / read_file) when the founder granted browser-scoped access, or (system_file_list / system_file_read) when they granted full system access — pull by context; do not ask them to re-upload. Only one of these pairs will actually work depending on which the founder granted; if a call errors, don't retry the same path with small variations, just say what's missing.
- Live internet search (web_search) — use it whenever you need current or external information, like a normal AI assistant.
- Background watches (create_watch / list_watches / cancel_watch) — when the founder asks you to “watch for” or “keep an eye on” a topic, create a watch. Findings surface later as quiet notices, never spoken interruptions.
- Desktop system actions (system_action) — only when registered: open_app (notepad|calculator|explorer|browser), lock_screen, or open_url. Every call pauses for an Allow click. Never invent apps or paths outside that allowlist.

Rules:
- A memory_read result is already provided below — use it; don't call memory_read again unless you need a fresh check.
- When prior-chat digest or memory mentions files/uploads/references, reuse them by name and fetch via file tools when content is needed.
- Use web_search for news, facts, docs, market data, or anything outside the founder's files/workspace.
- Use create_watch when they want ongoing monitoring; list_watches / cancel_watch to manage those. Do not invent watches they did not ask for.
- Use system_action only when the founder clearly asks to open one of the allowlisted apps, lock the screen, or open a specific URL — and only if that tool is available.
- Use list_files/read_file or system_file_list/system_file_read when the goal needs real file content. If no folder/files are connected, say so plainly rather than guessing.
- Use memory_write only for durable facts worth remembering across conversations (preferences, decisions, ongoing projects). Every memory_write is reviewed by the user before it's saved.
- Prefer short speakable sentences when answering conversationally. Lead with the outcome.
- After each tool result, decide: is the goal met? If yes, answer in plain text with no tool call. If not, call exactly the tool(s) you need next."""


async def run_agent_loop(
    goal: str,
    ctx: ToolContext,
    max_iterations: int = MAX_ITERATIONS,
    history: Optional[list[dict]] = None,
    cross_thread_context: Optional[str] = None,
) -> AsyncIterator[dict[str, Any]]:
    """
    Async generator yielding trace events as the loop progresses.
    copilot.py forwards each one directly as a WebSocket JSON message, so
    the frontend (and thus the user) sees the real trace live:

        {"type": "agent_started", "goal": str}
        {"type": "agent_tool_call", "iteration": int, "tool": str, "args": dict}
        {"type": "agent_observation", "iteration": int, "tool": str, "result": Any}
        {"type": "tool_request", "call_id": str, "tool": str, "args": dict}
            -- async_frontend tools reuse Stage 3's EXACT event shape, so
            the frontend's existing handleFileToolRequest() just works
            with zero changes for list_files/read_file.
        {"type": "agent_confirm_write", "call_id": str, "text": str, "source": str}
            -- pauses for the user's yes/no on a memory_write.
        {"type": "agent_final", "answer": str, "iterations_used": int}
        {"type": "agent_stopped", "reason": str, "partial_answer": str}

    Never raises on a tool failure, a timeout, or a declined write -- all
    of those become observations the model sees and can react to (or, in
    the worst case, the iteration cap yields agent_stopped instead of
    hanging or crashing the request).
    """
    provider = MODEL_REGISTRY.get(PLANNER_LABEL)
    if provider is None or not provider.is_configured():
        yield {"type": "agent_final", "answer": "No planner model is configured — I can't run an agent loop right now.", "iterations_used": 0}
        return

    yield {"type": "agent_started", "goal": goal}

    # Phase 11 — per-user communication style from preferences.h3ro_style
    try:
        from app.services.h3ro_style import format_style_prompt_block, get_user_h3ro_style

        _style = await get_user_h3ro_style(ctx.user_id)
        _system = AGENT_SYSTEM_PROMPT + "\n\n" + format_style_prompt_block(_style)
    except Exception:
        _system = AGENT_SYSTEM_PROMPT

    messages: list[dict[str, str]] = [
        {"role": "system", "content": _system},
    ]
    if cross_thread_context and cross_thread_context.strip():
        messages.append({
            "role": "user",
            "content": f"[prior_conversations digest]:\n{cross_thread_context.strip()[:3500]}",
        })
    # Full prior conversation so H3RO holds memory of the thread.
    for turn in (history or []):
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content[:8000]})
    messages.append({"role": "user", "content": goal})

    # Step zero: always consult memory before anything else happens.
    memory_tool = TOOL_REGISTRY.get("memory_read")
    if memory_tool is not None and memory_tool.execute is not None:
        yield {"type": "agent_tool_call", "iteration": 0, "tool": "memory_read", "args": {}}
        result = await memory_tool.execute({}, ctx)
        observation = result.content if result.success else {"error": result.error}
        # Prefer the most recent entries when the store is large
        if isinstance(observation, list) and len(observation) > 40:
            observation = observation[-40:]
        yield {"type": "agent_observation", "iteration": 0, "tool": "memory_read", "result": observation}
        messages.append({
            "role": "user",
            "content": f"[memory_read result, consulted before you started]: {json.dumps(observation)[:3500]}",
        })

    tool_defs = tool_definitions_for_planner()

    for iteration in range(1, max_iterations + 1):
        response_text = ""
        tool_calls = None
        t0 = time.time()
        async for chunk in provider.complete(messages, tools=tool_defs, stream=False, max_tokens=1200, timeout_s=60.0):
            if chunk.is_final:
                response_text = chunk.content or ""
                tool_calls = chunk.tool_calls
        log.info("agent_loop_planner_call", iteration=iteration, latency_ms=round((time.time() - t0) * 1000), had_tool_calls=bool(tool_calls))

        if not tool_calls:
            recovered = _recover_garbled_tool_call(response_text)
            if recovered:
                log.warning(
                    "agent_loop_recovered_garbled_tool_call",
                    iteration=iteration, tool=recovered[0]["name"],
                )
                tool_calls = recovered
            else:
                # Implicit reflection: the model chose to answer instead of
                # act, which means it judged the goal met.
                yield {"type": "agent_final", "answer": response_text or "I don't have a final answer to give.", "iterations_used": iteration}
                return

        messages.append({"role": "assistant", "content": response_text or ""})

        for tc in tool_calls:
            name = tc.get("name")
            try:
                args = json.loads(tc["arguments"]) if tc.get("arguments") else {}
            except Exception:
                args = {}

            spec = TOOL_REGISTRY.get(name)

            if spec is None:
                observation = {"error": f"unknown tool: {name!r}"}
                yield {"type": "agent_tool_call", "iteration": iteration, "tool": name, "args": args}
                yield {"type": "agent_observation", "iteration": iteration, "tool": name, "result": observation}

            elif name == "memory_write":
                yield {"type": "agent_tool_call", "iteration": iteration, "tool": name, "args": args}
                call_id, future = create_pending_call(ctx.workspace_id)
                yield {
                    "type": "agent_confirm_write", "call_id": call_id,
                    "text": args.get("text"), "source": args.get("source"),
                }
                approved = False
                async for tick in await_frontend_response(call_id, future, "memory_write_confirm", timeout_s=CONFIRM_TIMEOUT_S):
                    if tick is not None and tick.get("status") == "ok":
                        approved = bool(tick.get("result", {}).get("approved"))
                if approved and spec.execute is not None:
                    result = await spec.execute(args, ctx)
                    observation = result.content if result.success else {"error": result.error}
                else:
                    observation = {"skipped": "user did not approve this memory write"}
                yield {"type": "agent_observation", "iteration": iteration, "tool": name, "result": observation}

            elif name == "system_action":
                # Phase 6c: human confirm, then frontend/Electron executes.
                # Backend never runs OS commands — observation is the real
                # payload from the desktop (or a decline / rejection).
                from app.services.system_action_tool import (
                    describe_system_action,
                    validate_system_action_args,
                )
                yield {"type": "agent_tool_call", "iteration": iteration, "tool": name, "args": args}
                ok, err, normalized = validate_system_action_args(args)
                if not ok:
                    observation = {"error": err, "rejected": True}
                    yield {"type": "agent_observation", "iteration": iteration, "tool": name, "result": observation}
                else:
                    call_id, future = create_pending_call(ctx.workspace_id)
                    action = normalized["action"]
                    target = normalized.get("target")
                    yield {
                        "type": "agent_confirm_system_action",
                        "call_id": call_id,
                        "action": action,
                        "target": target,
                        "description": describe_system_action(action, target),
                    }
                    result_payload = None
                    async for tick in await_frontend_response(
                        call_id, future, "system_action_confirm", timeout_s=CONFIRM_TIMEOUT_S,
                    ):
                        if tick is not None and tick.get("status") == "ok":
                            result_payload = tick.get("result") or {}
                    if result_payload is None:
                        observation = {
                            "approved": False,
                            "success": False,
                            "detail": "timed out waiting for confirmation",
                        }
                    elif not result_payload.get("approved"):
                        observation = {
                            "approved": False,
                            "success": False,
                            "detail": result_payload.get("detail") or "user declined",
                        }
                    else:
                        # Frontend executed (or reported desktop-unavailable).
                        observation = {
                            "approved": True,
                            "success": bool(result_payload.get("success")),
                            "detail": result_payload.get("detail") or "",
                            "action": action,
                            "target": target,
                        }
                    yield {"type": "agent_observation", "iteration": iteration, "tool": name, "result": observation}

            elif spec.kind == "sync":
                yield {"type": "agent_tool_call", "iteration": iteration, "tool": name, "args": args}
                assert spec.execute is not None
                result = await spec.execute(args, ctx)
                observation = result.content if result.success else {"error": result.error}
                yield {"type": "agent_observation", "iteration": iteration, "tool": name, "result": observation}

            else:  # async_frontend
                call_id, future = create_pending_call(ctx.workspace_id)
                yield {"type": "tool_request", "call_id": call_id, "tool": name, "args": args}
                final_tick = None
                async for tick in await_frontend_response(call_id, future, name, timeout_s=spec.frontend_timeout_s):
                    if tick is not None:
                        final_tick = tick
                if final_tick and final_tick.get("status") == "ok":
                    observation = final_tick["result"]
                else:
                    observation = {"error": f"{name} did not respond in time"}
                yield {"type": "agent_observation", "iteration": iteration, "tool": name, "result": observation}

            # web_search results can be longer — allow more room
            cap = 4000 if name == "web_search" else 2000
            messages.append({
                "role": "user",
                "content": f"[{name} result]: {json.dumps(observation)[:cap]}",
            })

    yield {
        "type": "agent_stopped",
        "reason": "max_iterations_reached",
        "partial_answer": (
            f"I wasn't able to fully complete this within {max_iterations} steps. "
            "Here's what I'd found so far — you can ask me to continue with a more specific follow-up."
        ),
    }
