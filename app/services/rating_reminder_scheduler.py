"""Rating reminder at session end, queued in the durable ``job_queue`` table.

Survives restarts: the row is picked up by the job-queue poller after boot,
and re-pointed automatically when the session's start time or duration changes.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import to_utc
from app.models.session import GameSession
from app.services.job_queue import remove_job, upsert_job

logger = logging.getLogger(__name__)

_DEFAULT_DURATION_MINUTES = 60
JOB_TYPE = "rating_reminder"


def _compute_end_time(session: GameSession):
    """Expected end time as naive UTC (DB storage format)."""
    duration = session.duration_minutes or _DEFAULT_DURATION_MINUTES
    return to_utc(session.start_time).replace(tzinfo=None) + timedelta(minutes=duration)


async def register_rating_reminder(db: AsyncSession, session: GameSession) -> None:
    """Queue (or re-point) the rating-reminder job at session end time."""
    await upsert_job(db, JOB_TYPE, session.id, _compute_end_time(session))
    await db.commit()
    logger.info(
        "Queued %s for session %s at %s",
        JOB_TYPE,
        session.id,
        _compute_end_time(session).isoformat(),
    )


async def unregister_rating_reminder(db: AsyncSession, session_id: int) -> None:
    await remove_job(db, JOB_TYPE, session_id)
    await db.commit()
