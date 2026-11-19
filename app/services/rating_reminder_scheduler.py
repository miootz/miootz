"""Rating reminder at meetup end, queued in the durable ``job_queue`` table.

Survives restarts: the row is picked up by the job-queue poller after boot,
and re-pointed automatically when the meetup's start time or duration changes.
"""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meetup import Meetup
from app.services.job_queue import remove_job, upsert_job
from app.services.rating_windows import meetup_end_time

logger = logging.getLogger(__name__)

JOB_TYPE = "rating_reminder"


async def register_rating_reminder(db: AsyncSession, meetup: Meetup) -> None:
    """Queue (or re-point) the rating-reminder job at meetup end time."""
    run_at = meetup_end_time(meetup).replace(tzinfo=None)
    await upsert_job(db, JOB_TYPE, meetup.id, run_at)
    await db.commit()
    logger.info(
        "Queued %s for meetup %s at %s",
        JOB_TYPE,
        meetup.id,
        run_at.isoformat(),
    )


async def unregister_rating_reminder(db: AsyncSession, meetup_id: int) -> None:
    await remove_job(db, JOB_TYPE, meetup_id)
    await db.commit()
