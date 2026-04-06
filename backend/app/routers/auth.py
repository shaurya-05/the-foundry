import uuid
from fastapi import APIRouter, HTTPException, Header, Request, Depends
from pydantic import BaseModel, field_validator
from typing import Optional
from app.db.postgres import get_pool
from app.auth import (
    hash_password, verify_password, needs_rehash,
    create_token, create_refresh_token, decode_token,
)
from app.dependencies import AuthContext, require_auth
from app.services.email import send_verification_email, send_password_reset_email
from jose import JWTError
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter(prefix="/api/auth", tags=["auth"])

def _get_real_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)

_limiter = Limiter(key_func=_get_real_ip)


# ─── Request Models ──────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    avatar_color: Optional[str] = None
    workspace_name: Optional[str] = None
    preferences: Optional[dict] = None


class RefreshRequest(BaseModel):
    refresh_token: str


class VerifyEmailRequest(BaseModel):
    token: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class DeleteAccountRequest(BaseModel):
    password: str


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _require_token(authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")
    try:
        return decode_token(authorization.split(" ", 1)[1], expected_type="access")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def _token_response(uid: str, ws_id: str, email: str, display_name: str) -> dict:
    return {
        "access_token": create_token(uid, ws_id, email),
        "refresh_token": create_refresh_token(uid, ws_id, email),
        "token_type": "bearer",
        "user_id": uid,
        "workspace_id": ws_id,
        "email": email,
        "display_name": display_name,
    }


# ─── Register ─────────────────────────────────────────────────────────────────

@router.post("/register")
@_limiter.limit("5/minute")
async def register(req: RegisterRequest, request: Request):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT id FROM users WHERE email=$1", req.email)
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")

        ws_id = str(uuid.uuid4())
        display = req.display_name or req.email.split("@")[0]

        await conn.execute(
            "INSERT INTO workspaces (id, name, owner_id) VALUES ($1, $2, $3)",
            ws_id, f"{display}'s Workspace", ws_id,
        )

        user = await conn.fetchrow(
            """INSERT INTO users (email, workspace_id, role, display_name, password_hash, terms_accepted_at)
               VALUES ($1, $2, 'owner', $3, $4, NOW()) RETURNING id""",
            req.email, ws_id, display, hash_password(req.password),
        )
        uid = str(user["id"])

        await conn.execute("UPDATE workspaces SET owner_id=$1 WHERE id=$2", uid, ws_id)
        await conn.execute(
            "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING",
            ws_id, uid,
        )

        # Create email verification token and send
        vtoken = await conn.fetchval(
            "INSERT INTO email_verification_tokens (user_id) VALUES ($1) RETURNING token",
            uid,
        )
        await send_verification_email(req.email, vtoken)

        return _token_response(uid, ws_id, req.email, display)


# ─── Login ────────────────────────────────────────────────────────────────────

@router.post("/login")
@_limiter.limit("10/minute")
async def login(req: LoginRequest, request: Request):
    pool = await get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, workspace_id, password_hash, display_name, deleted_at FROM users WHERE email=$1",
            req.email,
        )
        if not user or not user["password_hash"]:
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if user["deleted_at"] is not None:
            raise HTTPException(status_code=401, detail="This account has been deleted")
        if not verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")

        uid = str(user["id"])
        ws_id = str(user["workspace_id"])

        if needs_rehash(user["password_hash"]):
            await conn.execute(
                "UPDATE users SET password_hash=$1 WHERE id=$2",
                hash_password(req.password), uid,
            )

        return _token_response(uid, ws_id, req.email, user["display_name"])


# ─── Refresh ──────────────────────────────────────────────────────────────────

@router.post("/refresh")
async def refresh(req: RefreshRequest):
    try:
        payload = decode_token(req.refresh_token, expected_type="refresh")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    return {
        "access_token": create_token(payload["sub"], payload["workspace_id"], payload["email"]),
        "token_type": "bearer",
    }


# ─── Email Verification ──────────────────────────────────────────────────────

@router.post("/verify-email")
async def verify_email(req: VerifyEmailRequest):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT id, user_id FROM email_verification_tokens
               WHERE token=$1 AND used=false AND expires_at > NOW()""",
            req.token,
        )
        if not row:
            raise HTTPException(status_code=400, detail="Invalid or expired verification token")

        await conn.execute("UPDATE email_verification_tokens SET used=true WHERE id=$1", row["id"])
        await conn.execute("UPDATE users SET email_verified=true WHERE id=$1", str(row["user_id"]))

    return {"verified": True}


@router.post("/resend-verification")
async def resend_verification(auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT email, email_verified FROM users WHERE id=$1", auth.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if user["email_verified"]:
            return {"sent": False, "message": "Email already verified"}

        # Invalidate old tokens
        await conn.execute(
            "UPDATE email_verification_tokens SET used=true WHERE user_id=$1 AND used=false",
            auth.user_id,
        )
        # Create new token
        vtoken = await conn.fetchval(
            "INSERT INTO email_verification_tokens (user_id) VALUES ($1) RETURNING token",
            auth.user_id,
        )
        await send_verification_email(user["email"], vtoken)

    return {"sent": True}


# ─── Forgot / Reset Password ─────────────────────────────────────────────────

@router.post("/forgot-password")
@_limiter.limit("3/minute")
async def forgot_password(req: ForgotPasswordRequest, request: Request):
    """Always returns 200 to prevent email enumeration."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, email FROM users WHERE email=$1 AND deleted_at IS NULL",
            req.email,
        )
        if user:
            # Invalidate old tokens
            await conn.execute(
                "UPDATE password_reset_tokens SET used=true WHERE user_id=$1 AND used=false",
                str(user["id"]),
            )
            rtoken = await conn.fetchval(
                "INSERT INTO password_reset_tokens (user_id) VALUES ($1) RETURNING token",
                str(user["id"]),
            )
            await send_password_reset_email(user["email"], rtoken)

    return {"sent": True}


@router.post("/reset-password")
@_limiter.limit("5/minute")
async def reset_password(req: ResetPasswordRequest, request: Request):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT id, user_id FROM password_reset_tokens
               WHERE token=$1 AND used=false AND expires_at > NOW()""",
            req.token,
        )
        if not row:
            raise HTTPException(status_code=400, detail="Invalid or expired reset token")

        uid = str(row["user_id"])
        # Update password
        await conn.execute(
            "UPDATE users SET password_hash=$1 WHERE id=$2",
            hash_password(req.new_password), uid,
        )
        # Invalidate ALL reset tokens for this user
        await conn.execute(
            "UPDATE password_reset_tokens SET used=true WHERE user_id=$1",
            uid,
        )

    return {"reset": True}


# ─── Account Deletion (soft) ─────────────────────────────────────────────────

@router.delete("/me")
async def delete_account(req: DeleteAccountRequest, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT password_hash FROM users WHERE id=$1",
            auth.user_id,
        )
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid password")

        # Check sole-owner constraint
        owned = await conn.fetch(
            """SELECT w.id, w.name FROM workspaces w
               WHERE w.owner_id=$1
               AND (SELECT COUNT(*) FROM workspace_members wm
                    WHERE wm.workspace_id=w.id AND wm.role='owner') = 1""",
            auth.user_id,
        )
        if owned:
            raise HTTPException(
                status_code=400,
                detail="Transfer ownership of your workspace before deleting your account",
            )

        # Hard delete all user data (GDPR right to be forgotten)
        # Use try/except for tables that may not exist in all environments
        for table, col in [
            ("copilot_messages", "user_id"),
            ("forge_outputs", "user_id"),
            ("agent_runs", "user_id"),
            ("email_verification_tokens", "user_id"),
            ("password_reset_tokens", "user_id"),
        ]:
            try:
                await conn.execute(f"DELETE FROM {table} WHERE {col}=$1", auth.user_id)
            except Exception:
                pass
        try:
            await conn.execute("DELETE FROM command_history WHERE workspace_id=$1", auth.workspace_id)
        except Exception:
            pass
        try:
            await conn.execute("DELETE FROM tasks WHERE workspace_id=$1 AND user_id=$2", auth.workspace_id, auth.user_id)
        except Exception:
            pass
        await conn.execute("DELETE FROM workspace_members WHERE user_id=$1", auth.user_id)
        await conn.execute("UPDATE users SET deleted_at=NOW(), email=email||'_deleted_'||id, password_hash=NULL, preferences='{}' WHERE id=$1", auth.user_id)

    return {"deleted": True}


# ─── Data Export ──────────────────────────────────────────────────────────────

@router.get("/export")
async def export_data(auth: AuthContext = Depends(require_auth)):
    """Full data export — includes all content for GDPR compliance."""
    import datetime
    pool = await get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT email, display_name, created_at FROM users WHERE id=$1", auth.user_id)
        projects = await conn.fetch("SELECT id, title, status, plan, metadata, created_at FROM projects WHERE workspace_id=$1", auth.workspace_id)
        tasks = await conn.fetch("SELECT id, title, description, status, priority, metadata, created_at FROM tasks WHERE workspace_id=$1", auth.workspace_id)
        knowledge = await conn.fetch("SELECT id, title, content, summary, type, source_url, tags, created_at FROM knowledge_items WHERE workspace_id=$1", auth.workspace_id)
        ideas = await conn.fetch("SELECT id, domains, content, metadata, created_at FROM ideas WHERE workspace_id=$1", auth.workspace_id)

        # These tables may not have workspace_id — query by user_id with fallback
        agent_runs = []
        copilot_msgs = []
        forge_outs = []
        try:
            agent_runs = await conn.fetch("SELECT id, agent_id, context, output, created_at FROM agent_runs WHERE workspace_id=$1", auth.workspace_id)
        except Exception:
            try:
                agent_runs = await conn.fetch("SELECT id, agent_id, context, output, created_at FROM agent_runs WHERE user_id=$1", auth.user_id)
            except Exception:
                pass
        try:
            copilot_msgs = await conn.fetch("SELECT role, content, created_at FROM copilot_messages WHERE workspace_id=$1 ORDER BY created_at", auth.workspace_id)
        except Exception:
            try:
                copilot_msgs = await conn.fetch("SELECT role, content, created_at FROM copilot_messages WHERE user_id=$1 ORDER BY created_at", auth.user_id)
            except Exception:
                pass
        try:
            forge_outs = await conn.fetch("SELECT type, input, output, created_at FROM forge_outputs WHERE workspace_id=$1", auth.workspace_id)
        except Exception:
            try:
                forge_outs = await conn.fetch("SELECT type, input, output, created_at FROM forge_outputs WHERE user_id=$1", auth.user_id)
            except Exception:
                pass

    def safe_dict(row):
        d = dict(row)
        for k, v in d.items():
            if isinstance(v, datetime.datetime):
                d[k] = v.isoformat()
            elif isinstance(v, (dict, list)):
                pass  # JSON-serializable already
            elif hasattr(v, '__str__') and not isinstance(v, (str, int, float, bool, type(None))):
                d[k] = str(v)
        return d

    return {
        "exported_at": datetime.datetime.utcnow().isoformat(),
        "user": safe_dict(user) if user else {},
        "projects": [safe_dict(r) for r in projects],
        "tasks": [safe_dict(r) for r in tasks],
        "knowledge": [safe_dict(r) for r in knowledge],
        "ideas": [safe_dict(r) for r in ideas],
        "agent_runs": [safe_dict(r) for r in agent_runs],
        "copilot_history": [safe_dict(r) for r in copilot_msgs],
        "forge_outputs": [safe_dict(r) for r in forge_outs],
    }


# ─── Me ───────────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_me(authorization: Optional[str] = Header(None)):
    payload = _require_token(authorization)
    pool = await get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, email, display_name, avatar_color, workspace_id, role, email_verified, preferences FROM users WHERE id=$1",
            payload["sub"],
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        ws = await conn.fetchrow(
            "SELECT id, name FROM workspaces WHERE id=$1", str(user["workspace_id"])
        )
        members_count = await conn.fetchval(
            "SELECT COUNT(*) FROM workspace_members WHERE workspace_id=$1",
            str(user["workspace_id"]),
        )
        members = await conn.fetch(
            """SELECT wm.user_id, wm.role, wm.joined_at, u.email, u.display_name, u.avatar_color
               FROM workspace_members wm
               JOIN users u ON u.id = wm.user_id
               WHERE wm.workspace_id=$1
               ORDER BY wm.joined_at""",
            str(user["workspace_id"]),
        )

        return {
            "id": str(user["id"]),
            "email": user["email"],
            "display_name": user["display_name"] or user["email"].split("@")[0],
            "avatar_color": user["avatar_color"] or "#E8231F",
            "workspace_id": str(user["workspace_id"]),
            "workspace_name": ws["name"] if ws else "My Workspace",
            "role": user["role"],
            "email_verified": user["email_verified"],
            "preferences": user["preferences"] or {},
            "members_count": int(members_count),
            "members": [
                {
                    "user_id": str(m["user_id"]),
                    "email": m["email"],
                    "display_name": m["display_name"] or m["email"].split("@")[0],
                    "avatar_color": m["avatar_color"] or "#E8231F",
                    "role": m["role"],
                    "joined_at": m["joined_at"].isoformat(),
                }
                for m in members
            ],
        }


@router.patch("/me")
async def update_me(req: ProfileUpdate, authorization: Optional[str] = Header(None)):
    payload = _require_token(authorization)
    pool = await get_pool()
    async with pool.acquire() as conn:
        sets, vals = [], [payload["sub"]]
        if req.display_name is not None:
            vals.append(req.display_name)
            sets.append(f"display_name=${len(vals)}")
        if req.avatar_color is not None:
            vals.append(req.avatar_color)
            sets.append(f"avatar_color=${len(vals)}")
        if req.preferences is not None:
            import json
            vals.append(json.dumps(req.preferences))
            sets.append(f"preferences=${len(vals)}::jsonb")
        if sets:
            await conn.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=$1", *vals)

        if req.workspace_name is not None:
            await conn.execute(
                "UPDATE workspaces SET name=$1 WHERE id=$2",
                req.workspace_name, payload["workspace_id"],
            )

        return {"success": True}
