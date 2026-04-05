import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Any, Dict
from app.db.postgres import get_pool
from app.db.redis import get_redis
from app.dependencies import AuthContext, require_auth

router = APIRouter(prefix="/api/blueprint", tags=["blueprint"])


class CanvasNode(BaseModel):
    id: str
    type: str
    title: str
    body: Optional[str] = None
    x: float
    y: float
    visibility: str = "team"


class CanvasSave(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]] = []


class NodeOp(BaseModel):
    op_type: str  # add_node | move_node | delete_node | update_node
    payload: Dict[str, Any]


async def _verify_workspace_access(auth: AuthContext, ws_id: str):
    """Ensure user is a member of the target workspace."""
    if ws_id == auth.workspace_id:
        return  # User's own workspace — always allowed
    pool = await get_pool()
    async with pool.acquire() as conn:
        member = await conn.fetchrow(
            "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
            ws_id, auth.user_id,
        )
        if not member:
            raise HTTPException(status_code=403, detail="Not a member of this workspace")


@router.get("")
async def get_canvas(workspace_id: Optional[str] = None, auth: AuthContext = Depends(require_auth)):
    ws_id = workspace_id or auth.workspace_id
    await _verify_workspace_access(auth, ws_id)
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM blueprint_canvas WHERE workspace_id=$1",
            ws_id,
        )
        if not row:
            return {"nodes": [], "edges": [], "updated_at": None}
        nodes = row["nodes"] if isinstance(row["nodes"], list) else json.loads(row["nodes"])
        edges = row["edges"] if isinstance(row["edges"], list) else json.loads(row["edges"])
        return {
            "nodes": nodes,
            "edges": edges,
            "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        }


@router.patch("")
async def save_canvas(body: CanvasSave, workspace_id: Optional[str] = None, auth: AuthContext = Depends(require_auth)):
    ws_id = workspace_id or auth.workspace_id
    await _verify_workspace_access(auth, ws_id)
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO blueprint_canvas (workspace_id, nodes, edges, updated_at, updated_by)
               VALUES ($1, $2::jsonb, $3::jsonb, NOW(), $4)
               ON CONFLICT (workspace_id) DO UPDATE
                 SET nodes=$2::jsonb, edges=$3::jsonb, updated_at=NOW(), updated_by=$4
               RETURNING *""",
            ws_id,
            json.dumps(body.nodes),
            json.dumps(body.edges),
            auth.user_id,
        )
        return {"ok": True, "updated_at": row["updated_at"].isoformat()}


@router.post("/op")
async def broadcast_op(op: NodeOp, workspace_id: Optional[str] = None, auth: AuthContext = Depends(require_auth)):
    """Record and broadcast a canvas operation via Redis pub/sub."""
    ws_id = workspace_id or auth.workspace_id
    await _verify_workspace_access(auth, ws_id)
    ws_id = workspace_id or auth.workspace_id
    pool = await get_pool()
    redis = await get_redis()

    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO blueprint_ops (workspace_id, user_id, op_type, payload)
               VALUES ($1, $2, $3, $4::jsonb)""",
            ws_id,
            auth.user_id,
            op.op_type,
            json.dumps(op.payload),
        )

    message = json.dumps({
        "type": "canvas_op",
        "op_type": op.op_type,
        "payload": op.payload,
        "user_id": auth.user_id,
    })
    await redis.publish(f"blueprint:{ws_id}", message)
    return {"ok": True}


@router.get("/ops")
async def get_recent_ops(workspace_id: Optional[str] = None, limit: int = 50, auth: AuthContext = Depends(require_auth)):
    ws_id = workspace_id or auth.workspace_id
    await _verify_workspace_access(auth, ws_id)
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, user_id, op_type, payload, created_at
               FROM blueprint_ops WHERE workspace_id=$1
               ORDER BY created_at DESC LIMIT $2""",
            ws_id, limit,
        )
        return {
            "ops": [
                {
                    "id": str(r["id"]),
                    "user_id": str(r["user_id"]),
                    "op_type": r["op_type"],
                    "payload": r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"]),
                    "created_at": r["created_at"].isoformat(),
                }
                for r in rows
            ]
        }
