from dotenv import load_dotenv
load_dotenv(override=True)

import os
import time
import uuid
import sentry_sdk
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.db.postgres import get_pool, close_pool
from app.db.redis import get_redis, close_redis
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import structlog
import asyncio, json

# ─── Environment ──────────────────────────────────────────────────────────────
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
IS_PROD = ENVIRONMENT == "production"

# ─── Sentry (set SENTRY_DSN env var to enable) ──────────────────────────────
_sentry_dsn = os.getenv("SENTRY_DSN")
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        traces_sample_rate=0.1 if IS_PROD else 0.5,
        environment=ENVIRONMENT,
    )

# ─── Structured logging ─────────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer() if not IS_PROD
        else structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO+
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)
log = structlog.get_logger()

# ─── Rate limiter ────────────────────────────────────────────────────────────
def _get_real_ip(request: Request) -> str:
    """Extract real client IP, respecting X-Forwarded-For behind proxies."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)

limiter = Limiter(key_func=_get_real_ip, default_limits=["200/minute"])

# Build allowed origins from env
_origins_env = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",") if o.strip()] or [
    "http://localhost:3000",
    "http://localhost:3001",
]

from app.routers import (
    knowledge, projects, ideas, tasks, agents,
    copilot, context, notifications, command, launchpad,
    blueprint, workspace, auth, subscription, analytics,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    await get_redis()
    try:
        from app.db.neo4j import init_graph
        await init_graph()
    except Exception as e:
        log.warning("neo4j_init_failed", error=str(e))
    log.info("startup_complete", origins=ALLOWED_ORIGINS, environment=ENVIRONMENT)
    yield
    await close_pool()
    await close_redis()
    try:
        from app.db.neo4j import close_driver
        await close_driver()
    except Exception:
        pass

app = FastAPI(
    title="THE FOUNDRY API",
    description="AI-powered builder operating system by h3ros",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if not IS_PROD else None,       # Disable Swagger in prod
    redoc_url="/api/redoc" if not IS_PROD else None,      # Disable ReDoc in prod
    openapi_url="/api/openapi.json" if not IS_PROD else None,
)

# ─── Middleware ───────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Attach a unique request ID to every request for tracing."""
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())[:8]
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    if request.url.path != "/health":  # Don't log health checks
        log.info(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=duration_ms,
            client=request.client.host if request.client else "unknown",
        )
    return response


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Add security headers to all responses."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Cache-Control"] = "no-store"
    return response


# ─── Standardized error handler ──────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("unhandled_error", path=request.url.path, error=str(exc))
    if _sentry_dsn:
        sentry_sdk.capture_exception(exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "detail": "An unexpected error occurred"},
    )


# Register all routers
app.include_router(knowledge.router)
app.include_router(projects.router)
app.include_router(ideas.router)
app.include_router(tasks.router)
app.include_router(agents.router)
app.include_router(copilot.router)
app.include_router(context.router)
app.include_router(notifications.router)
app.include_router(command.router)
app.include_router(launchpad.router)
app.include_router(blueprint.router)
app.include_router(workspace.router)
app.include_router(auth.router)
app.include_router(subscription.router)
app.include_router(analytics.router)


# ─── Health check (deep) ─────────────────────────────────────────────────────
@app.get("/health")
async def health():
    checks = {"api": "ok"}
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        checks["postgres"] = "ok"
    except Exception as e:
        checks["postgres"] = f"error: {e}"

    try:
        redis = await get_redis()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"

    try:
        from app.db.neo4j import get_driver
        driver = get_driver()
        async with driver.session() as session:
            await session.run("RETURN 1")
        checks["neo4j"] = "ok"
    except Exception as e:
        checks["neo4j"] = f"error: {e}"

    all_ok = all(v == "ok" for v in checks.values())
    status_code = 200 if all_ok else 503
    return JSONResponse(
        status_code=status_code,
        content={"status": "ok" if all_ok else "degraded", "checks": checks},
    )


# ─── WebSocket auth helper ───────────────────────────────────────────────────
from app.auth import decode_token
from jose import JWTError


async def _ws_authenticate(websocket: WebSocket) -> dict | None:
    """Authenticate WebSocket via query param ?token=xxx. Returns payload or None."""
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing token")
        return None
    try:
        return decode_token(token, expected_type="access")
    except JWTError:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return None


# ─── WebSocket: Pipeline streaming ───────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.connections: dict[str, WebSocket] = {}

    async def connect(self, run_id: str, ws: WebSocket):
        await ws.accept()
        self.connections[run_id] = ws

    def disconnect(self, run_id: str):
        self.connections.pop(run_id, None)

    async def send(self, run_id: str, data: dict):
        ws = self.connections.get(run_id)
        if ws:
            try:
                await ws.send_json(data)
            except Exception:
                self.disconnect(run_id)

manager = ConnectionManager()

@app.websocket("/ws/pipeline/{run_id}")
async def ws_pipeline(websocket: WebSocket, run_id: str):
    payload = await _ws_authenticate(websocket)
    if not payload:
        return
    await manager.connect(run_id, websocket)
    redis = await get_redis()
    try:
        pubsub = redis.pubsub()
        await pubsub.subscribe(f"pipeline:{run_id}")
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    await websocket.send_json(data)
                    if data.get("type") == "pipeline_complete":
                        break
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(run_id)

class BlueprintConnectionManager:
    """Manages WebSocket connections for live Blueprint canvas collaboration."""

    def __init__(self):
        self.rooms: dict[str, set[WebSocket]] = {}

    async def connect(self, workspace_id: str, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(workspace_id, set()).add(ws)

    def disconnect(self, workspace_id: str, ws: WebSocket):
        room = self.rooms.get(workspace_id, set())
        room.discard(ws)
        if not room:
            self.rooms.pop(workspace_id, None)

    async def broadcast(self, workspace_id: str, data: dict, exclude: WebSocket | None = None):
        room = self.rooms.get(workspace_id, set())
        dead = set()
        for ws in room:
            if ws is exclude:
                continue
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            room.discard(ws)

    def presence(self, workspace_id: str) -> int:
        return len(self.rooms.get(workspace_id, set()))


blueprint_manager = BlueprintConnectionManager()


@app.websocket("/ws/blueprint/{workspace_id}")
async def ws_blueprint(websocket: WebSocket, workspace_id: str):
    payload = await _ws_authenticate(websocket)
    if not payload:
        return
    # Verify user belongs to this workspace
    if payload.get("workspace_id") != workspace_id:
        await websocket.close(code=4003, reason="Workspace mismatch")
        return

    await blueprint_manager.connect(workspace_id, websocket)
    redis = await get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"blueprint:{workspace_id}")

    await blueprint_manager.broadcast(workspace_id, {
        "type": "presence",
        "count": blueprint_manager.presence(workspace_id),
    })

    async def redis_listener():
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    await blueprint_manager.broadcast(workspace_id, data)
                except Exception:
                    pass

    listener_task = asyncio.create_task(redis_listener())

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                op = json.loads(raw)
                await blueprint_manager.broadcast(workspace_id, op, exclude=websocket)
                await redis.publish(f"blueprint:{workspace_id}", raw)
            except Exception:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        listener_task.cancel()
        blueprint_manager.disconnect(workspace_id, websocket)
        await blueprint_manager.broadcast(workspace_id, {
            "type": "presence",
            "count": blueprint_manager.presence(workspace_id),
        })


@app.websocket("/ws/notifications")
async def ws_notifications(websocket: WebSocket):
    payload = await _ws_authenticate(websocket)
    if not payload:
        return
    user_id = payload["sub"]
    await websocket.accept()
    redis = await get_redis()
    try:
        pubsub = redis.pubsub()
        await pubsub.subscribe(f"notifications:{user_id}")
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    await websocket.send_text(message["data"])
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
