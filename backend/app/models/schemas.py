from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import datetime, date
from uuid import UUID

# ─── Auth ───────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str

class AuthToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    workspace_id: str

# ─── Knowledge ──────────────────────────────────────────────────────────────
class KnowledgeCreate(BaseModel):
    title: str
    content: str
    type: str = "text"
    tags: Optional[List[str]] = []
    source_url: Optional[str] = None

class KnowledgeItem(BaseModel):
    id: str
    workspace_id: str
    user_id: str
    title: str
    content: str
    summary: Optional[str] = None
    type: str
    tags: Optional[List[str]] = []
    source_url: Optional[str] = None
    visibility: str = "team"
    metadata: Optional[Dict[str, Any]] = {}
    created_at: datetime

class KnowledgeQueryRequest(BaseModel):
    question: str

# ─── Projects ───────────────────────────────────────────────────────────────
class ProjectCreate(BaseModel):
    title: str

class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    plan: Optional[str] = None
    status: Optional[str] = None
    visibility: Optional[str] = None
    clearance_level: Optional[int] = None

class Project(BaseModel):
    id: str
    workspace_id: str
    user_id: str
    title: str
    plan: Optional[str] = None
    status: str
    visibility: str = "private"
    clearance_level: int = 0
    metadata: Optional[Dict[str, Any]] = {}
    created_at: datetime

# ─── Ideas ──────────────────────────────────────────────────────────────────
class IdeaCreate(BaseModel):
    domains: str
    content: str

class IdeaForgeRequest(BaseModel):
    domains: str

class Idea(BaseModel):
    id: str
    workspace_id: str
    user_id: str
    domains: str
    content: str
    visibility: str = "private"
    clearance_level: int = 0
    metadata: Optional[Dict[str, Any]] = {}
    created_at: datetime

# ─── Tasks ──────────────────────────────────────────────────────────────────
class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "todo"
    priority: str = "medium"
    project_id: Optional[str] = None
    due_date: Optional[date] = None
    source: str = "manual"

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    project_id: Optional[str] = None
    due_date: Optional[date] = None

class Task(BaseModel):
    id: str
    workspace_id: str
    user_id: str
    title: str
    description: Optional[str] = None
    status: str
    priority: str
    project_id: Optional[str] = None
    due_date: Optional[date] = None
    source: str
    metadata: Optional[Dict[str, Any]] = {}
    created_at: datetime
    updated_at: datetime

class BulkStatusUpdate(BaseModel):
    task_ids: List[str]
    status: str

# ─── Agents ─────────────────────────────────────────────────────────────────
class AgentRunRequest(BaseModel):
    agent_id: str
    context: str

class PipelineRunRequest(BaseModel):
    pipeline_id: str
    context: str

class PipelineRunStatus(BaseModel):
    id: str
    pipeline_id: str
    status: str
    current_step: int
    step_outputs: List[Any]
    input: str
    started_at: datetime
    completed_at: Optional[datetime] = None

# ─── Copilot ─────────────────────────────────────────────────────────────────
class CopilotMessage(BaseModel):
    message: str
    workspace_context: Optional[Dict[str, Any]] = {}

class IntentRequest(BaseModel):
    message: str

class IntentResponse(BaseModel):
    intent: str
    confidence: float = 1.0
    params: Optional[Dict[str, Any]] = {}

# ─── Command ─────────────────────────────────────────────────────────────────
class CommandParseRequest(BaseModel):
    raw_input: str

# ─── Notifications ───────────────────────────────────────────────────────────
class Notification(BaseModel):
    id: str
    workspace_id: str
    user_id: str
    type: str
    title: str
    body: Optional[str] = None
    read: bool
    metadata: Optional[Dict[str, Any]] = {}
    created_at: datetime

# ─── Launch Brief ────────────────────────────────────────────────────────────
class LaunchBriefRequest(BaseModel):
    concept: str
