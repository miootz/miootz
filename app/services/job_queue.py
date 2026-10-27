"""Durable one-shot job queue backed by the SQLite ``job_queue`` table.

Replaces in-memory APScheduler one-shot jobs: rows survive restarts, a
scheduler poll runs every due job and deletes it.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.core.timeutil import utcnow
from app.models.job_queue import JobQueue

logger = logging.getLogger(__name__)

JobHandler = Callable[[int], Awaitable[None]]


def _rating_reminder_handler() -> JobHandler:
    # lazy import to avoid a cycle with app.services.jobs
    from app.services.jobs import send_rating_reminder_for_meetup

    return send_rating_reminder_for_meetup


# job_type -> lazy handler factory
_HANDLERS: dict[str, Callable[[], JobHandler]] = {
    "rating_reminder": _rating_reminder_handler,
}


async def upsert_job(
    db: AsyncSession, job_type: str, ref_id: int, run_at: datetime
) -> None:
    """Insert the job, or re-point its run_at if one already exists."""
    existing = (
        await db.execute(
            select(JobQueue).where(
                JobQueue.job_type == job_type, JobQueue.ref_id == ref_id
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.run_at = run_at
    else:
        db.add(
            JobQueue(
                job_type=job_type, ref_id=ref_id, run_at=run_at, created_at=utcnow()
            )
        )
    await db.flush()


async def remove_job(db: AsyncSession, job_type: str, ref_id: int) -> None:
    await db.execute(
        delete(JobQueue).where(
            JobQueue.job_type == job_type, JobQueue.ref_id == ref_id
        )
    )
    await db.flush()


async def run_due_jobs() -> int:
    """Run every queued job whose run_at has passed, then delete it.

    Returns the number of jobs processed. A failed handler is logged and the
    job is dropped (one-shot semantics, same as the old misfire_grace jobs).
    """
    async with async_session() as db:
        due = (
            (await db.execute(select(JobQueue).where(JobQueue.run_at <= utcnow())))
            .scalars()
            .all()
        )
        for job in due:
            factory = _HANDLERS.get(job.job_type)
            if factory is None:
                logger.warning("Unknown job type %r — dropping", job.job_type)
            else:
                try:
                    await factory()(job.ref_id)
                except Exception:
                    logger.exception("Job %s/%s failed", job.job_type, job.ref_id)
            await db.delete(job)
            await db.flush()
        if due:
            await db.commit()
    return len(due)
