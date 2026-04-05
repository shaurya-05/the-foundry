from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.models.schemas import CopilotMessage, IntentRequest, IntentResponse
from app.services.claude import stream_sse
from app.services.context_engine import get_workspace_summary, build_copilot_system
from app.dependencies import AuthContext, require_auth, RequireUsage
import re

router = APIRouter(prefix="/api/copilot", tags=["copilot"])

INTENT_PATTERNS = [
    (r"\b(run|use|deploy|launch)\s+(field analyst|systems architect|market scout|launch strategist)\b", "run_agent"),
    (r"\b(run|start|execute)\s+(pipeline|deep recon|launch readiness|full forge|blueprint)\b", "run_pipeline"),
    (r"\b(create|add|make)\s+(a\s+)?(task|todo)\b", "create_task"),
    (r"\b(create|start|new)\s+(a\s+)?(project|build)\b", "create_project"),
    (r"\b(go to|open|navigate|show me)\s+(knowledge|archive|projects|workshop|ideas|crucible|tasks|runsheet|agents|crew|workspace|blueprint|launchpad|context|signal)\b", "navigate"),
    (r"\b(status|overview|how many|what's in|workspace)\b", "workspace_status"),
    (r"\b(find|search|connect|link|related|relationship)\b", "find_connections"),
    (r"\b(analyze|deep dive|review|breakdown|evaluate)\s+(project|build)\b", "analyze_project"),
]

@router.post("/message")
async def copilot_message(req: CopilotMessage, auth: AuthContext = Depends(RequireUsage("copilot_messages"))):
    from app.services.usage import increment_usage
    await increment_usage(auth.workspace_id, "copilot_messages")
    summary = await get_workspace_summary(auth.workspace_id)
    system = build_copilot_system(summary)
    return StreamingResponse(
        stream_sse(system, req.message, max_tokens=500),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.post("/intent", response_model=IntentResponse)
async def classify_intent(req: IntentRequest, auth: AuthContext = Depends(require_auth)):
    msg = req.message.lower()
    for pattern, intent in INTENT_PATTERNS:
        if re.search(pattern, msg):
            return IntentResponse(intent=intent, confidence=0.9)
    return IntentResponse(intent="query", confidence=0.7)
