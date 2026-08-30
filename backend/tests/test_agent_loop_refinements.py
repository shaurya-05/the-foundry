"""
Unit tests for agent-loop refinements:
  - search-before-build surfaces existing answers before generation
  - measurable reflection criteria name specific failures for re-plan

Run:  python -m unittest tests.test_agent_loop_refinements -v
No DB / Ollama required.
"""
from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import MagicMock, patch

from app.services.agent_reflection import (
    format_reflect_replan_message,
    reflect_on_answer,
    should_run_reflection,
)
from app.services.agent_search_before_build import (
    find_existing_candidates,
    format_candidates_for_user,
    looks_like_build_goal,
    user_wants_fresh_build,
)


class TestSearchBeforeBuild(unittest.TestCase):
    def test_detects_build_goal(self):
        self.assertTrue(looks_like_build_goal(
            "Can you put together something for my investor update?"
        ))
        self.assertFalse(looks_like_build_goal("What's the weather?"))

    def test_fresh_build_skips_gate(self):
        self.assertTrue(user_wants_fresh_build("Build something new for the investor update"))
        self.assertFalse(user_wants_fresh_build("Draft an investor update"))

    def test_surfaces_memory_candidate_for_matching_goal(self):
        memory = [
            {
                "text": (
                    "Investor update outline for FOUND3RY: 50 signups this month, "
                    "raising a seed round, traction narrative and ask."
                ),
                "source": "user_stated",
                "created_at": "2026-08-01T00:00:00Z",
            },
            {
                "text": "Prefers British English spelling.",
                "source": "user_stated",
                "created_at": "2026-07-01T00:00:00Z",
            },
        ]
        goal = "Can you put together something for my investor update?"
        candidates = find_existing_candidates(goal, memory)
        self.assertGreaterEqual(len(candidates), 1)
        self.assertIn("investor", candidates[0].excerpt.lower())
        self.assertEqual(candidates[0].source, "memory")
        # Unrelated short preference must not be the top hit
        self.assertNotIn("British", candidates[0].excerpt)

    def test_no_candidates_when_memory_unrelated(self):
        memory = [
            {"text": "Likes dark roast coffee in the morning.", "source": "user_stated"},
        ]
        candidates = find_existing_candidates(
            "Draft an investor update about seed fundraising",
            memory,
        )
        self.assertEqual(candidates, [])


class TestReflectionCriteria(unittest.TestCase):
    def test_research_fails_without_web_search(self):
        result = reflect_on_answer(
            goal="What's the latest news on AI funding?",
            answer="Funding is up a lot this year across the board.",
            tools_used=["memory_read"],
            observations={"memory_read": []},
        )
        self.assertFalse(result.passed)
        ids = {f.id for f in result.failures}
        self.assertIn("sources_present", ids)
        msg = format_reflect_replan_message(result)
        self.assertIn("sources_present", msg)
        self.assertIn("web_search", msg)

    def test_file_fails_when_only_list_without_read(self):
        result = reflect_on_answer(
            goal="Summarize the pitch deck file in my workspace in detail.",
            answer="The pitch deck looks strong with great traction.",
            tools_used=["list_files"],
            observations={"list_files": {"error": "list_files did not respond in time"}},
        )
        self.assertFalse(result.passed)
        self.assertIn("file_was_read", {f.id for f in result.failures})

    def test_file_fails_when_summary_not_grounded(self):
        result = reflect_on_answer(
            goal="Summarize the pitch deck file",
            answer="The company is doing great with many customers worldwide.",
            tools_used=["read_file"],
            observations={
                "read_file": {
                    "content": (
                        "FOUND3RY seed round narrative. Wall thickness for the "
                        "prototype must stay above 2.4mm per the print guide."
                    )
                }
            },
        )
        self.assertFalse(result.passed)
        ids = {f.id for f in result.failures}
        self.assertIn("summary_grounded", ids)

    def test_file_passes_when_grounded(self):
        result = reflect_on_answer(
            goal="Summarize the pitch deck file",
            answer="The FOUND3RY seed narrative notes wall thickness must stay above 2.4mm.",
            tools_used=["read_file"],
            observations={
                "read_file": {
                    "content": (
                        "FOUND3RY seed round narrative. Wall thickness for the "
                        "prototype must stay above 2.4mm per the print guide."
                    )
                }
            },
        )
        self.assertTrue(result.passed)

    def test_memory_empty_must_be_acknowledged(self):
        result = reflect_on_answer(
            goal="What do you remember about my preferences?",
            answer="You prefer morning meetings and short emails.",
            tools_used=["memory_read"],
            observations={"memory_read": []},
        )
        self.assertFalse(result.passed)
        self.assertIn("memory_hit_real", {f.id for f in result.failures})

    def test_skip_reflection_for_pure_chat(self):
        self.assertFalse(should_run_reflection("hey what's up", ["memory_read"]))


class TestLoopTraceSearchBeforeBuild(unittest.IsolatedAsyncioTestCase):
    """Prove the loop yields search_before_build then surfaces — no planner build."""

    async def test_loop_surfaces_existing_before_build(self):
        from app.services.agent_tools import ToolContext, ToolResult, ToolSpec

        memory_payload = [
            {
                "text": (
                    "Investor update draft: FOUND3RY has 50 signups this month "
                    "and is raising a seed round with a clear ask."
                ),
                "source": "conversation_digest",
            }
        ]

        async def _mem_exec(args, ctx):
            return ToolResult(success=True, content=memory_payload)

        mem_spec = ToolSpec(
            name="memory_read",
            description="test",
            input_schema={"type": "object", "properties": {}},
            kind="sync",
            execute=_mem_exec,
        )

        # Planner must NOT be called when candidates are found
        mock_provider = MagicMock()
        mock_provider.is_configured.return_value = True

        async def _never_complete(*a, **k):
            raise AssertionError("planner should not run when candidates are surfaced")
            yield  # pragma: no cover

        mock_provider.complete = _never_complete

        events: list[dict[str, Any]] = []
        with patch.dict("app.services.agent_loop.TOOL_REGISTRY", {"memory_read": mem_spec}, clear=False), \
             patch("app.services.agent_loop.MODEL_REGISTRY", {"FACTUAL": mock_provider}), \
             patch("app.services.agent_loop.tool_definitions_for_planner", return_value=[]):
            from app.services import agent_loop as al

            ctx = ToolContext(workspace_id="ws", user_id="u", thread_id="t")
            async for ev in al.run_agent_loop(
                "Can you put together something for my investor update?",
                ctx,
                history=[],
                cross_thread_context=None,
            ):
                events.append(ev)

        types = [e["type"] for e in events]
        tools = [e.get("tool") for e in events if e["type"] == "agent_tool_call"]
        self.assertIn("agent_started", types)
        self.assertIn("search_before_build", tools)
        self.assertIn("agent_final", types)
        final = next(e for e in events if e["type"] == "agent_final")
        self.assertIn("existing material", final["answer"].lower())
        self.assertIn("50 signups", final["answer"])
        # No planner iterations
        self.assertEqual(final["iterations_used"], 0)
        # Observation proves the step, not just the final wording
        sbb_obs = next(
            e for e in events
            if e["type"] == "agent_observation" and e.get("tool") == "search_before_build"
        )
        self.assertEqual(sbb_obs["result"]["action"], "surface_to_user")
        self.assertGreaterEqual(sbb_obs["result"]["candidate_count"], 1)


class TestLoopTraceReflectReplan(unittest.IsolatedAsyncioTestCase):
    async def test_reflect_names_criterion_and_replans(self):
        from app.services.agent_tools import ToolContext, ToolResult, ToolSpec
        from app.services.model_provider import ModelResponse

        async def _mem_exec(args, ctx):
            return ToolResult(success=True, content=[])

        mem_spec = ToolSpec(
            name="memory_read",
            description="test",
            input_schema={"type": "object", "properties": {}},
            kind="sync",
            execute=_mem_exec,
        )

        call_n = {"n": 0}

        async def _complete(messages, **kwargs):
            call_n["n"] += 1
            # First finalize without web_search → reflect fails → replan message injected
            if call_n["n"] == 1:
                yield ModelResponse(content="Funding is booming everywhere.", is_final=True, tool_calls=None)
                return
            # Second call should see the specific reflect failure in messages
            joined = " ".join(m.get("content", "") for m in messages)
            self.assertIn("sources_present", joined)
            self.assertIn("web_search", joined)
            yield ModelResponse(
                content="I need current sources — searching next would fix sources_present.",
                is_final=True,
                tool_calls=None,
            )

        mock_provider = MagicMock()
        mock_provider.is_configured.return_value = True
        mock_provider.complete = _complete

        events: list[dict[str, Any]] = []
        with patch.dict("app.services.agent_loop.TOOL_REGISTRY", {"memory_read": mem_spec}, clear=False), \
             patch("app.services.agent_loop.MODEL_REGISTRY", {"FACTUAL": mock_provider}), \
             patch("app.services.agent_loop.tool_definitions_for_planner", return_value=[]):
            from app.services import agent_loop as al

            ctx = ToolContext(workspace_id="ws", user_id="u", thread_id="t")
            async for ev in al.run_agent_loop(
                "What's the latest news on AI funding markets?",
                ctx,
            ):
                events.append(ev)

        reflect_obs = [
            e for e in events
            if e["type"] == "agent_observation" and e.get("tool") == "reflect"
        ]
        self.assertGreaterEqual(len(reflect_obs), 1)
        first = reflect_obs[0]["result"]
        self.assertFalse(first["passed"])
        fail_ids = {f["id"] for f in first["failed_criteria"]}
        self.assertIn("sources_present", fail_ids)
        # First finalize → reflect fail → re-plan (at least one more planner call)
        self.assertGreaterEqual(call_n["n"], 2)
        # Re-plan message carried the named criterion into the next planner turn
        self.assertTrue(
            any(
                e["type"] == "agent_observation"
                and e.get("tool") == "reflect"
                and any(f["id"] == "sources_present" for f in e["result"].get("failed_criteria", []))
                for e in events
            )
        )


if __name__ == "__main__":
    unittest.main()
