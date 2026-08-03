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
import time
from typing import Any, AsyncIterator, Optional

import structlog

from app.services.agent_tools import (
    TOOL_REGISTRY, ToolContext, await_frontend_response, create_pending_call,
    tool_definitions_for_planner,
)
from app.services.model_provider import MODEL_REGISTRY

log = structlog.get_logger()

MAX_ITERATIONS = 8
PLANNER_LABEL = "STRATEGIC"
CONFIRM_TIMEOUT_S = 60.0  # a human deciding yes/no needs longer than a file read

AGENT_SYSTEM_PROMPT = """You are an autonomous agent working on the user's stated goal, not just answering a single question. Work step by step using the tools available to you.

Rules:
- A memory_read result is already provided below, from before you started -- use it, don't call memory_read again unless something later in the task specifically requires a fresh check.
- Use list_files/read_file to inspect the user's connected local folder when the goal requires real file content. If no folder is connected or a file isn't found, say so plainly rather than guessing at contents.
- Use memory_write only for genuinely durable facts worth remembering across future conversations -- not scratch state for this task alone. Every memory_write is reviewed by the user before it's saved; you will be told if it was approved or declined.
- After each tool result, decide: is the goal now fully met? If yes, respond with your final answer as plain text and no tool call -- lead with the outcome, don't recap your process. If not, call exactly the tool(s) you need next. Don't call a tool you don't need."""


async def run_agent_loop(
    goal: str,
    ctx: ToolContext,
    max_iterations: int = MAX_ITERATIONS,
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

    messages: list[dict[str, str]] = [
        {"role": "system", "content": AGENT_SYSTEM_PROMPT},
        {"role": "user", "content": goal},
    ]

    # Step zero: always consult memory before anything else happens.
    memory_tool = TOOL_REGISTRY.get("memory_read")
    if memory_tool is not None and memory_tool.execute is not None:
        yield {"type": "agent_tool_call", "iteration": 0, "tool": "memory_read", "args": {}}
        result = await memory_tool.execute({}, ctx)
        observation = result.content if result.success else {"error": result.error}
        yield {"type": "agent_observation", "iteration": 0, "tool": "memory_read", "result": observation}
        messages.append({
            "role": "user",
            "content": f"[memory_read result, consulted before you started]: {json.dumps(observation)[:2000]}",
        })

    tool_defs = tool_definitions_for_planner()

    for iteration in range(1, max_iterations + 1):
        response_text = ""
        tool_calls = None
        t0 = time.time()
        async for chunk in provider.complete(messages, tools=tool_defs, stream=False, max_tokens=800, timeout_s=60.0):
            if chunk.is_final:
                response_text = chunk.content or ""
                tool_calls = chunk.tool_calls
        log.info("agent_loop_planner_call", iteration=iteration, latency_ms=round((time.time() - t0) * 1000), had_tool_calls=bool(tool_calls))

        if not tool_calls:
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

            messages.append({
                "role": "user",
                "content": f"[{name} result]: {json.dumps(observation)[:2000]}",
            })

    yield {
        "type": "agent_stopped",
        "reason": "max_iterations_reached",
        "partial_answer": (
            f"I wasn't able to fully complete this within {max_iterations} steps. "
            "Here's what I'd found so far — you can ask me to continue with a more specific follow-up."
        ),
    }
