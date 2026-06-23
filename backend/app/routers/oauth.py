"""
OAuth router — third-party connector authorization flow.

Per Phase 2 brief §4.1.2 (passive ingestion from where founders already
work), each user authorizes one or more third-party providers (GitHub
first; Linear and Notion follow). The authorization code flow:

    GET  /api/oauth/{provider}/start
         -> 302 to provider authorize URL with signed `state` token
         -> Sets `oauth_csrf` HttpOnly cookie tied to the state

    GET  /api/oauth/{provider}/callback?code=...&state=...
         -> Verifies state JWT + cookie nonce
         -> Exchanges code for access_token at provider's token endpoint
         -> Encrypts via oauth_encryption.encrypt_token
         -> Upserts into oauth_connections (idempotent per user+provider)
         -> 302 back to frontend `/settings/connections?status=connected`

    GET  /api/oauth/connections      -> list active connections
    DEL  /api/oauth/connections/{provider} -> soft-revoke

State is a short-lived (5 min) HS256 JWT carrying user_id, workspace_id,
provider, and a CSRF nonce. The same nonce is set as a cookie at start
and verified at callback — defeats anyone who steals the state URL but
not the cookie.

Token endpoint failures and provider returning `error=` are logged but
do not leak provider response bodies to the user.
"""
from __future__ import annotations

import os
import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import json as _json
import structlog
from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel

from app.auth import ALGORITHM, SECRET_KEY
from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth
from app.services import graph_repo
from app.services.oauth_encryption import encrypt_token
from app.services.notion_sync import run_initial_notion_sync

log = structlog.get_logger()

router = APIRouter(prefix="/api/oauth", tags=["oauth"])


async def _notion_initial_sync(workspace_id: str, user_id: str, access_token: str):
    await run_initial_notion_sync(workspace_id, user_id, access_token)


# ─── Provider registry ────────────────────────────────────────────────────

class ProviderConfig:
    __slots__ = ("name", "client_id", "client_secret", "authorize_url", "token_url", "scopes", "user_url")

    def __init__(
        self,
        name: str,
        *,
        client_id_env: str,
        client_secret_env: str,
        authorize_url: str,
        token_url: str,
        scopes: str,
        user_url: str,
    ):
        self.name = name
        self.client_id = os.getenv(client_id_env, "")
        self.client_secret = os.getenv(client_secret_env, "")
        self.authorize_url = authorize_url
        self.token_url = token_url
        self.scopes = scopes
        self.user_url = user_url

    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)


PROVIDERS: dict[str, ProviderConfig] = {
    "github": ProviderConfig(
        name="github",
        client_id_env="GITHUB_OAUTH_CLIENT_ID",
        client_secret_env="GITHUB_OAUTH_CLIENT_SECRET",
        authorize_url="https://github.com/login/oauth/authorize",
        token_url="https://github.com/login/oauth/access_token",
        # repo: read commits/PRs/issues; read:user: identify the GitHub user
        scopes="repo read:user read:org",
        user_url="https://api.github.com/user",
    ),
        "notion": ProviderConfig(
        name="notion",
        client_id_env="NOTION_OAUTH_CLIENT_ID",
        client_secret_env="NOTION_OAUTH_CLIENT_SECRET",
        authorize_url="https://api.notion.com/v1/oauth/authorize",
        token_url="https://api.notion.com/v1/oauth/token",
        scopes="",
        user_url="https://api.notion.com/v1/users/me",
    ),
    "google": ProviderConfig(
        name="google",
        client_id_env="GOOGLE_OAUTH_CLIENT_ID",
        client_secret_env="GOOGLE_OAUTH_CLIENT_SECRET",
        authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        scopes="https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/documents email profile",
        user_url="https://www.googleapis.com/oauth2/v3/userinfo",
    ),
}


def _get_provider(provider: str) -> ProviderConfig:
    cfg = PROVIDERS.get(provider)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")
    if not cfg.is_configured():
        raise HTTPException(
            status_code=503,
            detail=f"{provider} OAuth is not configured on this server",
        )
    return cfg


# ─── State token helpers ──────────────────────────────────────────────────

_STATE_TTL_MINUTES = 5
_STATE_COOKIE_NAME = "oauth_csrf"


def _mint_state(user_id: str, workspace_id: str, provider: str) -> tuple[str, str]:
    """Returns (state_jwt, csrf_nonce). Nonce goes in the cookie."""
    nonce = secrets.token_urlsafe(24)
    exp = datetime.now(timezone.utc) + timedelta(minutes=_STATE_TTL_MINUTES)
    state = jwt.encode(
        {
            "sub": user_id,
            "workspace_id": workspace_id,
            "provider": provider,
            "nonce": nonce,
            "exp": exp,
            "type": "oauth_state",
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return state, nonce


def _verify_state(state: str, provider: str, cookie_nonce: Optional[str]) -> dict:
    if not state:
        raise HTTPException(status_code=400, detail="Missing state")
    if not cookie_nonce:
        raise HTTPException(status_code=400, detail="Missing CSRF cookie — start the flow fresh")
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        raise HTTPException(status_code=400, detail="Invalid or expired state") from e
    if payload.get("type") != "oauth_state":
        raise HTTPException(status_code=400, detail="Wrong token type")
    if payload.get("provider") != provider:
        raise HTTPException(status_code=400, detail="Provider mismatch")
    if not secrets.compare_digest(payload.get("nonce", ""), cookie_nonce):
        raise HTTPException(status_code=400, detail="CSRF nonce mismatch")
    return payload


# ─── Helpers ──────────────────────────────────────────────────────────────


def _frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000")


def _callback_url(request: Request, provider: str) -> str:
    """The redirect_uri we register with the provider. Must match exactly."""
    explicit = os.getenv("OAUTH_REDIRECT_BASE")  # e.g. https://api.found3ry.com
    if explicit:
        base = explicit.rstrip("/")
    else:
        # Derive from request — useful in development.
        base = f"{request.url.scheme}://{request.url.netloc}"
    return f"{base}/api/oauth/{provider}/callback"


# ─── Start endpoint ───────────────────────────────────────────────────────


def _set_csrf_cookie(response, nonce: str) -> None:
    is_prod = os.getenv("ENVIRONMENT", "development") == "production"
    response.set_cookie(
        key=_STATE_COOKIE_NAME,
        value=nonce,
        max_age=_STATE_TTL_MINUTES * 60,
        httponly=True,
        # Cross-site OAuth round-trip requires SameSite=None+Secure in prod;
        # Lax suffices for same-host dev.
        secure=is_prod,
        samesite="none" if is_prod else "lax",
        path="/api/oauth",
    )


@router.post("/{provider}/authorize-url")
async def oauth_authorize_url(
    provider: str,
    request: Request,
    auth: AuthContext = Depends(require_auth),
):
    """
    Return the provider authorize URL + set the CSRF cookie.

    The frontend then does a top-level navigation to the URL. We can't
    use a 302 here because the fetch is cross-origin and JavaScript
    cannot read Location off an opaqueredirect.
    """
    cfg = _get_provider(provider)
    state, nonce = _mint_state(auth.user_id, auth.workspace_id, provider)
    params = {
        "client_id": cfg.client_id,
        "redirect_uri": _callback_url(request, provider),
        "scope": cfg.scopes,
        "state": state,
        "allow_signup": "false",
    }
    if provider == "google":
        params["access_type"] = "offline"
        params["prompt"] = "consent"
        params["response_type"] = "code"
        params.pop("allow_signup", None)
    url = f"{cfg.authorize_url}?{urllib.parse.urlencode(params)}"
    response = JSONResponse({"authorize_url": url})
    _set_csrf_cookie(response, nonce)
    log.info("oauth_authorize_url", provider=provider, user_id=auth.user_id)
    return response


@router.get("/{provider}/start")
async def oauth_start(
    provider: str,
    request: Request,
    auth: AuthContext = Depends(require_auth),
):
    """Legacy 302 endpoint — kept for same-origin contexts and webhooks."""
    cfg = _get_provider(provider)
    state, nonce = _mint_state(auth.user_id, auth.workspace_id, provider)
    params = {
        "client_id": cfg.client_id,
        "redirect_uri": _callback_url(request, provider),
        "scope": cfg.scopes,
        "state": state,
        "allow_signup": "false",
    }
    if provider == "google":
        params["access_type"] = "offline"
        params["prompt"] = "consent"
        params["response_type"] = "code"
        params.pop("allow_signup", None)
    url = f"{cfg.authorize_url}?{urllib.parse.urlencode(params)}"
    response = RedirectResponse(url=url, status_code=302)
    _set_csrf_cookie(response, nonce)
    log.info("oauth_start", provider=provider, user_id=auth.user_id)
    return response


# ─── Callback endpoint ────────────────────────────────────────────────────


def _kick_initial_sync(workspace_id: str, user_id: str, background: BackgroundTasks) -> None:
    """Try Celery first; fall back to FastAPI BackgroundTasks for dev / no-worker."""
    try:
        from workers.pipeline_worker import github_initial_sync
        github_initial_sync.delay(workspace_id, user_id)
        log.info("github_sync_enqueued_celery", workspace_id=workspace_id)
    except Exception as e:
        log.warning("github_sync_celery_unavailable_falling_back", error=str(e))
        from app.services.github_sync import run_initial_github_sync
        background.add_task(run_initial_github_sync, workspace_id=workspace_id, user_id=user_id)


@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str,
    request: Request,
    background: BackgroundTasks,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    oauth_csrf: Optional[str] = Cookie(None),
):
    """Provider redirects here. Exchanges code → encrypted token → DB."""
    fe = _frontend_url().rstrip("/")
    if error:
        log.warning("oauth_provider_error", provider=provider, error=error, detail=error_description)
        return RedirectResponse(
            url=f"{fe}/settings/connections?status=error&reason={urllib.parse.quote(error)}",
            status_code=302,
        )

    cfg = _get_provider(provider)
    if not code:
        raise HTTPException(status_code=400, detail="Missing code")
    payload = _verify_state(state or "", provider, oauth_csrf)

    # Exchange code for token
    # Notion uses HTTP Basic auth; others use form body credentials
    import base64 as _b64
    if provider == "notion":
        _creds = _b64.b64encode(f"{cfg.client_id}:{cfg.client_secret}".encode()).decode()
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_resp = await client.post(
                cfg.token_url,
                json={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": _callback_url(request, provider),
                },
                headers={
                    "Authorization": f"Basic {_creds}",
                    "Accept": "application/json",
                },
            )
    elif provider == "google":
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_resp = await client.post(
                cfg.token_url,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": cfg.client_id,
                    "client_secret": cfg.client_secret,
                    "redirect_uri": _callback_url(request, provider),
                },
                headers={"Accept": "application/json"},
            )
    else:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_resp = await client.post(
                cfg.token_url,
                data={
                    "client_id": cfg.client_id,
                    "client_secret": cfg.client_secret,
                    "code": code,
                    "redirect_uri": _callback_url(request, provider),
                },
                headers={"Accept": "application/json"},
            )
    if token_resp.status_code >= 400:
        log.error("oauth_token_exchange_failed", provider=provider, status=token_resp.status_code)
        return RedirectResponse(
            url=f"{fe}/settings/connections?status=error&reason=token_exchange_failed",
            status_code=302,
        )

    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        log.error("oauth_no_access_token", provider=provider, response_keys=list(token_data.keys()))
        return RedirectResponse(
            url=f"{fe}/settings/connections?status=error&reason=no_token",
            status_code=302,
        )

    refresh_token = token_data.get("refresh_token")
    scope = token_data.get("scope", "")
    expires_in = token_data.get("expires_in")  # GitHub omits; Linear/Notion may include
    expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        if expires_in else None
    )

    # Identify the provider user (so we can correlate edges later)
    provider_user_id: Optional[str] = None
    provider_user_login: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            ur = await client.get(
                cfg.user_url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            if ur.status_code == 200:
                user_json = ur.json()
                if provider == "notion":
                    provider_user_id = str(user_json.get("id") or "") or None
                    provider_user_login = user_json.get("name") or str(user_json.get("id"))
                else:
                    provider_user_id = str(user_json.get("id") or "") or None
                    provider_user_login = user_json.get("login") or user_json.get("username")
    except Exception as e:
        log.warning("oauth_user_lookup_failed", provider=provider, error=str(e))

    # Encrypt and persist
    enc_access = encrypt_token(access_token)
    enc_refresh = encrypt_token(refresh_token) if refresh_token else None

    pool = await get_pool()
    async with pool.acquire() as conn:
        await graph_repo.upsert_oauth_connection(
            conn,
            workspace_id=payload["workspace_id"],
            user_id=payload["sub"],
            provider=provider,
            access_token_encrypted=enc_access,
            refresh_token_encrypted=enc_refresh,
            provider_user_id=provider_user_id,
            provider_user_login=provider_user_login,
            scopes=[s.strip() for s in scope.split(",") if s.strip()] if scope else None,
            expires_at=expires_at,
        )
        # Read onboarding step inside the same connection to avoid a second acquire
        onboarding_step = await conn.fetchval(
            "SELECT onboarding_step FROM workspaces WHERE id=$1",
            payload["workspace_id"],
        )

    log.info(
        "oauth_connected",
        provider=provider,
        user_id=payload["sub"],
        workspace_id=payload["workspace_id"],
        provider_user_login=provider_user_login,
    )

    # Kick off the initial sync so the graph populates without a manual click.
    if provider == "github":
        _kick_initial_sync(payload["workspace_id"], payload["sub"], background)
    elif provider == "notion":
        background.add_task(
            _notion_initial_sync,
            workspace_id=payload["workspace_id"],
            user_id=payload["sub"],
            access_token=access_token,
        )

    # Route the callback redirect based on onboarding state.
    if onboarding_step is not None and onboarding_step < 2:
        dest = f"{fe}/onboarding/connect?status=connected&provider={provider}"
    else:
        dest = f"{fe}/settings/connections?status=connected&provider={provider}"

    response = RedirectResponse(url=dest, status_code=302)
    response.delete_cookie(_STATE_COOKIE_NAME, path="/api/oauth")
    return response


# ─── List + revoke ────────────────────────────────────────────────────────


class OAuthConnectionView(BaseModel):
    provider: str
    provider_user_login: Optional[str]
    scopes: Optional[list[str]]
    connected_at: datetime
    expires_at: Optional[datetime]
    last_sync_at: Optional[datetime]


@router.get("/connections", response_model=list[OAuthConnectionView])
async def list_connections(auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT provider, provider_user_login, scopes, created_at, expires_at, last_sync_at
            FROM oauth_connections
            WHERE user_id=$1 AND revoked_at IS NULL
            ORDER BY created_at DESC
            """,
            auth.user_id,
        )
    return [
        OAuthConnectionView(
            provider=r["provider"],
            provider_user_login=r["provider_user_login"],
            scopes=list(r["scopes"]) if r["scopes"] else None,
            connected_at=r["created_at"],
            expires_at=r["expires_at"],
            last_sync_at=r["last_sync_at"],
        )
        for r in rows
    ]


@router.post("/connections/{provider}/sync")
async def trigger_sync(
    provider: str,
    background: BackgroundTasks,
    auth: AuthContext = Depends(require_auth),
):
    """Manually trigger a re-sync. Useful after large repo changes or imports."""
    if provider != "github":
        raise HTTPException(status_code=400, detail="Only github is supported today")
    pool = await get_pool()
    async with pool.acquire() as conn:
        conn_row = await graph_repo.get_oauth_connection(conn, auth.user_id, provider)
    if not conn_row:
        raise HTTPException(status_code=404, detail="No active GitHub connection")
    _kick_initial_sync(auth.workspace_id, auth.user_id, background)
    return {"status": "enqueued", "provider": provider}


def _parse_progress(v) -> dict:
    if v is None:
        return {}
    if isinstance(v, dict):
        return v
    try:
        return _json.loads(v)
    except (TypeError, ValueError):
        return {}


class SyncJobView(BaseModel):
    id: str
    provider: str
    status: str
    phase: Optional[str]
    progress: dict
    error: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


@router.get("/sync/status", response_model=list[SyncJobView])
async def sync_status(auth: AuthContext = Depends(require_auth)):
    """Recent sync jobs for the current workspace, newest first."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, provider, status, phase, progress, error, started_at, completed_at
            FROM sync_jobs
            WHERE workspace_id = $1
            ORDER BY created_at DESC
            LIMIT 10
            """,
            auth.workspace_id,
        )
    return [
        SyncJobView(
            id=str(r["id"]),
            provider=r["provider"],
            status=r["status"],
            phase=r["phase"],
            progress=_parse_progress(r["progress"]),
            error=r["error"],
            started_at=r["started_at"],
            completed_at=r["completed_at"],
        )
        for r in rows
    ]


@router.delete("/connections/{provider}")
async def revoke_connection(
    provider: str,
    auth: AuthContext = Depends(require_auth),
):
    if provider not in PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")
    pool = await get_pool()
    async with pool.acquire() as conn:
        revoked = await graph_repo.revoke_oauth_connection(conn, auth.user_id, provider)
    if not revoked:
        raise HTTPException(status_code=404, detail="No active connection for that provider")
    log.info("oauth_revoked", provider=provider, user_id=auth.user_id)
    return JSONResponse({"status": "revoked", "provider": provider})
