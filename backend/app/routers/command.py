from fastapi import APIRouter, Depends
from app.models.schemas import CommandParseRequest
from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth
import re

router = APIRouter(prefix="/api/command", tags=["command"])

NAV_SECTIONS = {
    "dashboard": "/dashboard", "archive": "/knowledge", "knowledge": "/knowledge",
    "workshop": "/projects", "projects": "/projects", "crucible": "/ideas", "ideas": "/ideas",
    "launchpad": "/launchpad", "blueprint": "/workspace", "workspace": "/workspace",
    "runsheet": "/tasks", "tasks": "/tasks", "signal room": "/context", "context": "/context",
    "crew": "/agents", "agents": "/agents",
}

COMMAND_PATTERNS = [
    (r"^go to (.+)$", "navigate"),
    (r"^open (.+)$", "navigate"),
    (r"^new (build|project)$", "create_project"),
    (r"^forge ideas?(.*)$", "forge_ideas"),
    (r"^run (.+) agent$", "run_agent"),
    (r"^run (.+) pipeline$", "run_pipeline"),
    (r"^(deep recon|launch readiness|full forge|blueprint design)$", "run_pipeline"),
    (r"^add task (.+)$", "create_task"),
]

@router.post("/parse")
async def parse_command(req: CommandParseRequest, auth: AuthContext = Depends(require_auth)):
    raw = req.raw_input.strip().lower()
    action = {"type": "unknown", "raw": req.raw_input}

    for pattern, intent in COMMAND_PATTERNS:
        m = re.match(pattern, raw)
        if m:
            action["type"] = intent
            if m.groups():
                action["param"] = m.group(1).strip()
            if intent == "navigate" and action.get("param"):
                dest = action["param"]
                for key, path in NAV_SECTIONS.items():
                    if key in dest:
                        action["path"] = path
                        break
            break

    if action["type"] == "unknown":
        for key, path in NAV_SECTIONS.items():
            if key in raw:
                action = {"type": "navigate", "path": path, "raw": req.raw_input}
                break

    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO command_history (workspace_id, raw_input, parsed_action)
               VALUES ($1, $2, $3::jsonb)""",
            auth.workspace_id, req.raw_input, str(action).replace("'", '"')
        )

    return action

@router.get("/history")
async def get_command_history(auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT * FROM command_history WHERE workspace_id=$1
               ORDER BY ts DESC LIMIT 20""",
            auth.workspace_id
        )
        return [{"id": str(r["id"]), "raw": r["raw_input"], "action": r["parsed_action"], "ts": r["ts"].isoformat()} for r in rows]
