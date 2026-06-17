"""One-shot APScheduler job per session: rating reminder at session end time."""

from __future__ import annotations

import logging
from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.jobstores.base import JobLookupError
from apscheduler.triggers.date import DateTrigger

from app.core.config import settings
from app.models.session import GameSession

logger = logging.getLogger(__name__)

_DEFAULT_DURATION_MINUTES = 60
JOB_PREFIX = "rating_reminder_"


def get_scheduler():
    from app.services import scheduler_setup

    return scheduler_setup.scheduler


def unregister_rating_reminder(session_id: int) -> None:
    sched = get_scheduler()
    if not sched:
        return
    job_id = f"{JOB_PREFIX}{session_id}"
    try:
        sched.remove_job(job_id)
    except JobLookupError:
        pass


def _compute_end_time(session: GameSession) -> str | None:
    """Compute expected end time as ISO string (UTC-aware) or None."""
    from datetime import datetime, timezone

    duration = session.duration_minutes or _DEFAULT_DURATION_MINUTES
    start = session.start_time
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    end = start.astimezone(timezone.utc) + timedelta(minutes=duration)
    return end.isoformat()


def register_rating_reminder(session: GameSession) -> None:
    """Schedule a one-shot job to send rating reminder at session end time."""
    sched = get_scheduler()
    if not sched:
        return

    end_time = _compute_end_time(session)
    if end_time is None:
        return

    job_id = f"{JOB_PREFIX}{session.id}"

    from app.services.jobs import send_rating_reminder_for_session

    sched.add_job(
        send_rating_reminder_for_session,
        DateTrigger(run_date=end_time, timezone= settings.SCHEDULER_TIMEZONE),
        id=job_id,
        args=[session.id],
        replace_existing=True,
        misfire_grace_time=300,  # 5 min grace
    )
    logger.info(
        "Scheduled rating reminder job %s at %s for session %s",
        job_id,
        end_time,
        session.id,
    )
