"""Shared FastAPI dependencies for auth and context extraction."""
from fastapi import Header, HTTPException, Depends
from typing import Optional
from app.auth import decode_token
from jose import JWTError

ROLE_HIERARCHY = {"owner": 4, "admin": 3, "member": 2, "viewer": 1}


class AuthContext:
    """Holds authenticated user info extracted from JWT."""
    __slots__ = ("user_id", "workspace_id", "email")

    def __init__(self, user_id: str, workspace_id: str, email: str):
        self.user_id = user_id
        self.workspace_id = workspace_id
        self.email = email


async def require_auth(authorization: Optional[str] = Header(None)) -> AuthContext:
    """Dependency: extract and validate JWT from Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")
    try:
        payload = decode_token(authorization.split(" ", 1)[1], expected_type="access")
        return AuthContext(
            user_id=payload["sub"],
            workspace_id=payload["workspace_id"],
            email=payload["email"],
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def RequireRole(min_role: str):
    """Factory: returns a dependency that checks workspace membership role."""

    async def _check(auth: AuthContext = Depends(require_auth)) -> AuthContext:
        from app.db.postgres import get_pool
        pool = await get_pool()
        async with pool.acquire() as conn:
            member = await conn.fetchrow(
                "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
                auth.workspace_id, auth.user_id,
            )
            if not member:
                raise HTTPException(status_code=403, detail="Not a member of this workspace")
            user_level = ROLE_HIERARCHY.get(member["role"], 0)
            required_level = ROLE_HIERARCHY.get(min_role, 0)
            if user_level < required_level:
                raise HTTPException(status_code=403, detail=f"Requires {min_role} role or higher")
        return auth

    return _check


def RequireUsage(resource: str):
    """Factory: returns a dependency that checks usage limits before allowing the request."""

    async def _check(auth: AuthContext = Depends(require_auth)) -> AuthContext:
        from app.services.usage import check_limit, check_storage_limit
        # Storage resources use count-based checks
        if resource in ("projects", "knowledge_items", "team_members"):
            allowed = await check_storage_limit(auth.workspace_id, resource)
        else:
            allowed = await check_limit(auth.workspace_id, resource)
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail=f"Usage limit reached for {resource}. Upgrade your plan to continue.",
            )
        return auth

    return _check
