"""Celery worker for async pipeline execution."""
import os
from celery import Celery

celery_app = Celery(
    "foundry",
    broker=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    backend=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

# Note: Pipeline execution is handled directly via SSE streaming in the agents router.
# This worker is available for long-running background jobs if needed.
@celery_app.task
def health_check():
    return {"status": "ok"}
