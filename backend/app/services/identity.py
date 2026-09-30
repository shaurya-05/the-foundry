"""Identity & Access — the single entry point to who-you-are and what-you-may-do.

Stage 4, service 2 of 4. This module IS the boundary described by
`docs/contracts/identity-access.v1.yaml`. Nothing outside this service imports
`app.auth`, `app.dependencies`, `app.services.access`, `app.services.usage` or
`app.services.email` directly any more.

Twenty-four inbound imports were reaching into this service's internals, which
made it the most entangled of the six. Almost all of them wanted the same four
FastAPI dependencies, so most of the move is re-exporting those from one place
and rewriting the import line.

Why the dependencies are re-exported rather than wrapped
--------------------------------------------------------
`require_auth`, `RequirePermission`, `RequireRole` and `RequireUsage` are
FastAPI dependency callables. FastAPI inspects their signatures to build the
request graph, so a wrapper that changes the signature changes the behaviour of
every endpoint using it. They are re-exported by name: same objects, one door.

Unlike the Model Gateway facade these imports are eager, and safely so — this
service sits at the bottom of the dependency graph. It imports nothing from
another service, which is exactly what you would expect of the thing everything
else authenticates against, and is also why there is no cycle to avoid.
"""
from __future__ import annotations

from typing import Any, Optional

# ─── Session and authorisation (the FastAPI dependency surface) ──────────────
from app.dependencies import (  # noqa: F401
    ROLE_HIERARCHY,
    AuthContext,
    RequirePermission,
    RequireRole,
    RequireUsage,
    require_auth,
)

# ─── Tokens and credentials ──────────────────────────────────────────────────
from app.auth import (  # noqa: F401
    ALGORITHM,
    SECRET_KEY,
    create_refresh_token,
    create_token,
    decode_token,
    hash_password,
    needs_rehash,
    verify_password,
)

# ─── Permissions and the audit log ───────────────────────────────────────────
from app.services.access import (  # noqa: F401
    has_permission,
    record_audit,
    user_permissions,
)

# ─── Entitlement (billing expressed as what an org may do) ───────────────────
from app.services.usage import (  # noqa: F401
    check_limit,
    check_storage_limit,
    get_current_usage,
    get_workspace_plan,
    increment_usage,
)

# ─── Notification of identity events ─────────────────────────────────────────
from app.services.email import (  # noqa: F401
    send_password_reset_email,
    send_verification_email,
    send_workspace_invite_email,
)


async def purge(workspace_id: str, user_id: Optional[str] = None,
                dry_run: bool = True) -> dict[str, Any]:
    """Contract: purge_workspace, for this service's own tables.

    Identity & Access orchestrates account deletion, but it is also a service
    that holds data, and it purges its own through the same interface as
    everyone else. Sessions and credentials are handled by the deletion
    endpoint, which soft-deletes the user rather than removing the row — a hard
    delete would break every foreign key that references them.
    """
    from app.db.purge import TableSpec, purge_tables

    # `audit_log` is deliberately NOT here. It is append-only, enforced by a
    # database trigger on both backends (IA-3), so including it would either
    # raise or -- worse -- require weakening the guarantee to make a purge
    # succeed. A record that someone's access was granted or refused is a record
    # of what the system did, not personal content, and it survives the account.
    # If that ever needs to change it is a deliberate decision about the audit
    # guarantee, not a line added to a purge spec.
    specs = [
        TableSpec("workspace_invitations", user_purgeable=False),
    ]
    return await purge_tables("identity_access", specs, workspace_id, user_id, dry_run)


__all__ = [
    "ROLE_HIERARCHY", "AuthContext", "RequirePermission", "RequireRole",
    "RequireUsage", "require_auth",
    "ALGORITHM", "SECRET_KEY", "create_refresh_token", "create_token",
    "decode_token", "hash_password", "needs_rehash", "verify_password",
    "has_permission", "record_audit", "user_permissions",
    "check_limit", "check_storage_limit", "get_current_usage",
    "get_workspace_plan", "increment_usage",
    "send_password_reset_email", "send_verification_email",
    "send_workspace_invite_email",
    "purge",
]
