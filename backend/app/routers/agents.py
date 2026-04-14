from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.models.schemas import AgentRunRequest, PipelineRunRequest
from app.db.postgres import get_pool
from app.services.claude import stream_sse
from app.services.context_engine import get_workspace_summary
from app.dependencies import AuthContext, require_auth
import uuid, json

router = APIRouter(prefix="/api/agents", tags=["agents"])

AGENTS = {
    "field_analyst": {
        "name": "Field Analyst",
        "system": """You are an expert research analyst. Analyze the provided context and:
1) Summarize key technical insights
2) Extract core concepts and technologies
3) Identify potential applications
4) Recommend related research directions

Use ## headers for each section. Be precise and cite specific details from the context.""",
    },
    "systems_architect": {
        "name": "Systems Architect",
        "system": """You are a senior systems architect. Analyze the project context and:
1) Suggest system architecture with components
2) Recommend technology stack with justification
3) Identify technical risks and mitigations
4) Evaluate feasibility (1–10 with reasoning)
5) Propose phased implementation approach

Use ## headers for each section.""",
    },
    "market_scout": {
        "name": "Market Scout",
        "system": """You are a market research strategist. Analyze the concept and:
1) Estimate total addressable market with reasoning
2) Identify 3–5 direct competitors with brief analysis
3) Define target customer segments
4) Suggest product positioning strategy
5) Identify key market risks

Use ## headers for each section.""",
    },
    "launch_strategist": {
        "name": "Launch Strategist",
        "system": """You are a startup advisor with YC-level experience. Analyze this concept and create:
1) Two-sentence elevator pitch
2) MVP feature set (Phase 1 only, max 5 features)
3) Go-to-market strategy
4) Key metrics to track in first 90 days
5) Funding path recommendation

Use ## headers for each section.""",
    },
}

# Task-to-agent mapping for "Run with Agent" suggestions
AGENT_TASK_KEYWORDS = {
    "field_analyst": ["research", "analyze", "investigate", "study", "explore", "review", "assess", "survey", "evaluate data", "literature"],
    "systems_architect": ["design", "architect", "build", "implement", "develop", "integrate", "database", "api", "infrastructure", "technical", "system", "stack", "backend", "frontend"],
    "market_scout": ["market", "competitor", "customer", "pricing", "segment", "positioning", "tam", "opportunity", "demand", "audience", "user research"],
    "launch_strategist": ["launch", "go-to-market", "gtm", "pitch", "funding", "strategy", "mvp", "metrics", "kpi", "growth", "acquisition", "campaign", "pre-seed", "investor"],
}

PIPELINES = {
    "deep_recon": {
        "name": "Deep Recon",
        "description": "Research → Architecture. Deep technical analysis.",
        "steps": [
            {"agent": "field_analyst", "input": "user"},
            {"agent": "systems_architect", "input": "prev"},
        ],
    },
    "launch_readiness": {
        "name": "Launch Readiness",
        "description": "Market sizing → Startup strategy. Full business validation.",
        "steps": [
            {"agent": "market_scout", "input": "user"},
            {"agent": "launch_strategist", "input": "prev"},
        ],
    },
    "full_forge": {
        "name": "Full Forge Run",
        "description": "All 4 crew members in sequence. Maximum intelligence depth.",
        "steps": [
            {"agent": "field_analyst", "input": "user"},
            {"agent": "systems_architect", "input": "prev"},
            {"agent": "market_scout", "input": "prev"},
            {"agent": "launch_strategist", "input": "prev"},
        ],
    },
    "blueprint_design": {
        "name": "Blueprint Design",
        "description": "Architecture → Market fit. Design-first approach.",
        "steps": [
            {"agent": "systems_architect", "input": "user"},
            {"agent": "market_scout", "input": "prev"},
        ],
    },
}


async def _build_agent_context(workspace_id: str, user_context: str) -> str:
    """Enrich user-provided context with workspace data so agents have full awareness."""
    summary = await get_workspace_summary(workspace_id)

    projects_ctx = "\n".join(
        f"  - {p['title']} [{p['status']}]" +
        (f": {p.get('plan_excerpt', '')[:150]}" if p.get('plan_excerpt') else "")
        for p in summary.get("projects", [])
    ) or "  (none)"

    tasks_ctx = "\n".join(
        f"  - [{t.get('priority', 'medium')}] {t['title']} ({t['status']})" +
        (f" [project: {t['project']}]" if t.get('project') else "")
        for t in summary.get("open_tasks", [])[:10]
    ) or "  (none)"

    knowledge_ctx = "\n".join(
        f"  - {k['title']}: {(k.get('summary') or k.get('excerpt') or '')[:80]}"
        for k in summary.get("knowledge", [])[:8]
    ) or "  (none)"

    ideas_ctx = "\n".join(
        f"  - {i['domains']}: {(i.get('excerpt') or '')[:100]}"
        for i in summary.get("ideas", [])[:5]
    ) or "  (none)"

    return f"""═══ WORKSPACE CONTEXT ═══

PROJECTS:
{projects_ctx}

OPEN TASKS:
{tasks_ctx}

KNOWLEDGE BASE ({summary.get('knowledge_count', 0)} items):
{knowledge_ctx}

IDEAS:
{ideas_ctx}

═══ USER REQUEST ═══

{user_context}"""


@router.get("/suggest")
async def suggest_agent(task_title: str, task_description: str = "", auth: AuthContext = Depends(require_auth)):
    """Suggest the best agent for a given task based on keywords."""
    text = (task_title + " " + task_description).lower()
    scores = {}
    for agent_id, keywords in AGENT_TASK_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in text)
        if score > 0:
            scores[agent_id] = score

    if not scores:
        # Default to field_analyst for generic tasks
        return {"suggested_agent": "field_analyst", "confidence": "low", "all_scores": {}}

    best = max(scores, key=scores.get)
    confidence = "high" if scores[best] >= 3 else "medium" if scores[best] >= 2 else "low"
    return {
        "suggested_agent": best,
        "suggested_agent_name": AGENTS[best]["name"],
        "confidence": confidence,
        "all_scores": {k: {"agent_name": AGENTS[k]["name"], "score": v} for k, v in sorted(scores.items(), key=lambda x: -x[1])},
    }


@router.post("/run")
async def run_agent(req: AgentRunRequest, auth: AuthContext = Depends(require_auth)):
    agent = AGENTS.get(req.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{req.agent_id}' not found")

    # Enrich context with workspace data
    enriched_context = await _build_agent_context(auth.workspace_id, req.context)

    async def stream_and_save():
        full_output = []
        async for chunk in stream_sse(agent["system"], enriched_context, max_tokens=1500):
            full_output.append(chunk)
            yield chunk
        output_text = ""
        for chunk in full_output:
            if chunk.startswith("data: "):
                try:
                    data = json.loads(chunk[6:])
                    if data.get("type") == "text_delta":
                        output_text += data.get("text", "")
                except Exception:
                    pass
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO agent_runs (workspace_id, user_id, agent_id, context, output)
                   VALUES ($1, $2, $3, $4, $5)""",
                auth.workspace_id, auth.user_id, req.agent_id, req.context, output_text
            )
            await conn.execute(
                """INSERT INTO activity_events (workspace_id, user_id, type, title)
                   VALUES ($1, $2, 'agent_run', $3)""",
                auth.workspace_id, auth.user_id, f"{agent['name']} ran"
            )
        # Send notification
        try:
            from app.services.notifications import create_notification
            await create_notification(
                auth.workspace_id, auth.user_id,
                "agent_run_complete", f"{agent['name']} analysis complete",
            )
        except Exception:
            pass

    return StreamingResponse(
        stream_and_save(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.post("/pipeline/run")
async def run_pipeline(req: PipelineRunRequest, auth: AuthContext = Depends(require_auth)):
    pipeline = PIPELINES.get(req.pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline '{req.pipeline_id}' not found")

    run_id = str(uuid.uuid4())
    pool = await get_pool()

    # Enrich the initial context with workspace data
    enriched_context = await _build_agent_context(auth.workspace_id, req.context)

    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO pipeline_runs (id, workspace_id, pipeline_id, status, input)
               VALUES ($1, $2, $3, 'running', $4)""",
            run_id, auth.workspace_id, req.pipeline_id, req.context
        )

    async def run_steps():
        step_outputs = []
        for i, step in enumerate(pipeline["steps"]):
            agent = AGENTS[step["agent"]]
            # First step uses enriched context, subsequent steps use previous output
            input_text = enriched_context if step["input"] == "user" else step_outputs[-1] if step_outputs else enriched_context

            yield f"data: {json.dumps({'type': 'step_start', 'step': i, 'agent': step['agent'], 'agent_name': agent['name']})}\n\n"

            output_text = ""
            async for chunk in stream_sse(agent["system"], input_text, max_tokens=1200):
                if chunk.startswith("data: "):
                    try:
                        data = json.loads(chunk[6:])
                        if data.get("type") == "text_delta":
                            output_text += data.get("text", "")
                            yield f"data: {json.dumps({'type': 'step_delta', 'step': i, 'text': data['text']})}\n\n"
                    except Exception:
                        pass
            step_outputs.append(output_text)

            yield f"data: {json.dumps({'type': 'step_complete', 'step': i, 'agent': step['agent']})}\n\n"

            pool = await get_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO pipeline_step_logs (run_id, step_index, agent, status, input, output)
                       VALUES ($1, $2, $3, 'complete', $4, $5)""",
                    run_id, i, step["agent"], input_text[:2000], output_text
                )

        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """UPDATE pipeline_runs SET status='complete', completed_at=NOW(),
                   step_outputs=$1, current_step=$2 WHERE id=$3""",
                json.dumps(step_outputs), len(step_outputs), run_id
            )
            await conn.execute(
                """INSERT INTO activity_events (workspace_id, user_id, type, title)
                   VALUES ($1, $2, 'pipeline_run', $3)""",
                auth.workspace_id, auth.user_id, f"Pipeline: {pipeline['name']}"
            )
        # Send notification
        try:
            from app.services.notifications import create_notification
            await create_notification(
                auth.workspace_id, auth.user_id,
                "pipeline_complete", f"Pipeline complete: {pipeline['name']}",
            )
        except Exception:
            pass

        yield f"data: {json.dumps({'type': 'pipeline_complete', 'run_id': run_id})}\n\n"

    return StreamingResponse(
        run_steps(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.get("/pipeline/{run_id}")
async def get_pipeline_run(run_id: str, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM pipeline_runs WHERE id=$1 AND workspace_id=$2",
            run_id, auth.workspace_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        return dict(row)
