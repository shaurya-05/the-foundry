"""
Celery task: weekly portfolio digest.

Registered on the beat schedule in pipeline_worker.py — fires every Monday
at 08:00 UTC.  Can also be triggered manually via the admin endpoint:

    POST /admin/digest/trigger   (HTTP Basic auth required)
"""
import asyncio

from workers.pipeline_worker import celery_app


@celery_app.task(name="digest.send_weekly_digest", bind=True, max_retries=1)
def send_weekly_digest(self):
    """Run the weekly digest job synchronously inside Celery's worker process."""
    from app.services.digest import run_weekly_digest
    try:
        result = asyncio.run(run_weekly_digest())
        return result
    except Exception as exc:
        raise self.retry(exc=exc, countdown=300)
