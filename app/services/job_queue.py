"""Durable one-shot job queue backed by the SQLite ``job_queue`` table.

Rows survive restarts. Each poll commits its claim before invoking the
handler, and another poll can recover a job whose claim has expired.
"""

from __future__ import annotations

import logging
import sqlite3
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta

from sqlalchemy import delete, or_, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.core.timeutil import utcnow
from app.models.job_queue import JobQueue

logger = logging.getLogger(__name__)

JobHandler = Callable[[int], Awaitable[None]]
_CLAIM_DURATION = timedelta(minutes=10)


def _rating_reminder_handler() -> JobHandler:
    # lazy import to avoid a cycle with app.services.jobs
    from app.services.jobs import send_rating_reminder_for_meetup

    return send_rating_reminder_for_meetup


def _signup_hold_handler() -> JobHandler:
    from app.services.meetup_signup import expire_signup_hold

    return expire_signup_hold


# job_type -> lazy handler factory
_HANDLERS: dict[str, Callable[[], JobHandler]] = {
    "rating_reminder": _rating_reminder_handler,
    "signup_hold_expiry": _signup_hold_handler,
}


async def upsert_job(
    db: AsyncSession, job_type: str, ref_id: int, run_at: datetime
) -> None:
    """Insert the job, or re-point its run_at if one already exists."""
    await db.execute(
        insert(JobQueue)
        .values(job_type=job_type, ref_id=ref_id, run_at=run_at, created_at=utcnow())
        .on_conflict_do_update(
            index_elements=[JobQueue.job_type, JobQueue.ref_id],
            set_={"run_at": run_at},
        )
    )


async def remove_job(db: AsyncSession, job_type: str, ref_id: int) -> None:
    await db.execute(
        delete(JobQueue).where(
            JobQueue.job_type == job_type, JobQueue.ref_id == ref_id
        )
    )
    await db.flush()


async def run_due_jobs() -> int:
    """Run due jobs after committing each claim, so handlers can write independently."""
    cutoff = utcnow()
    available = or_(JobQueue.claimed_until.is_(None), JobQueue.claimed_until <= cutoff)
    async with async_session() as db:
        due = (
            await db.scalars(
                select(JobQueue.id)
                .where(JobQueue.run_at <= cutoff, available)
                .order_by(JobQueue.run_at, JobQueue.id)
            )
        ).all()

    processed = 0
    for job_id in due:
        claim = utcnow() + _CLAIM_DURATION
        async with async_session() as db:
            job = (
                await db.execute(
                    update(JobQueue)
                    .where(JobQueue.id == job_id, JobQueue.run_at <= cutoff, available)
                    .values(claimed_until=claim)
                    .returning(JobQueue.job_type, JobQueue.ref_id, JobQueue.run_at)
                )
            ).one_or_none()
            await db.commit()
        if job is None:
            continue

        job_type, ref_id, run_at = job
        factory = _HANDLERS.get(job_type)
        retry = False
        if factory is None:
            logger.warning("Unknown job type %r — dropping", job_type)
        else:
            try:
                await factory()(ref_id)
            except Exception as error:
                logger.exception("Job %s/%s failed", job_type, ref_id)
                if isinstance(error, OperationalError):
                    code = getattr(error.orig, "sqlite_errorcode", 0) or 0
                    retry = (code & 0xff) in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED)

        async with async_session() as db:
            owned = (JobQueue.id == job_id, JobQueue.claimed_until == claim)
            if not retry:
                await db.execute(delete(JobQueue).where(*owned, JobQueue.run_at == run_at))
                processed += 1
            # An admin can reschedule a claimed job while its handler is running.
            await db.execute(update(JobQueue).where(*owned).values(claimed_until=None))
            await db.commit()
    return processed
