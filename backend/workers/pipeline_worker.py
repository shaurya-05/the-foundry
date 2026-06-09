"""Celery worker for async pipeline execution + connector sync."""
import asyncio
import os
from celery import Celery
from celery.schedules import crontab

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
    beat_schedule={
        # Every Monday at 08:00 UTC
        "weekly-digest-monday-8am": {
            "task": "digest.send_weekly_digest",
            "schedule": crontab(hour=8, minute=0, day_of_week=1),
        },
    },
)


# Note: Pipeline execution is handled directly via SSE streaming in the agents router.
# This worker is available for long-running background jobs if needed.
@celery_app.task
def health_check():
    return {"status": "ok"}


@celery_app.task(name="github.initial_sync", bind=True, max_retries=2)
def github_initial_sync(self, workspace_id: str, user_id: str):
    """
    Run the initial GitHub sync for a (workspace, user) pair.

    Per Phase 2 §4.1.2 — fired by the OAuth callback after a successful
    connection. Idempotent: safe to re-run.
    """
    from app.services.github_sync import run_initial_github_sync
    try:
        return asyncio.run(
            run_initial_github_sync(workspace_id=workspace_id, user_id=user_id)
        )
    except Exception as e:
        raise self.retry(exc=e, countdown=60)


# Register digest task so the beat scheduler can dispatch it
import workers.digest_worker  # noqa: F401, E402
