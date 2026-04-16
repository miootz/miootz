"""One APScheduler cron job per active recurrence rule (weekly at announce_* wall time)."""

from __future__ import annotations

import logging
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.jobstores.base import JobLookupError
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from app.core.database import async_session
from app.models.session_recurrence import SessionRecurrenceRule

logger = logging.getLogger(__name__)

JOB_PREFIX = "recurrence_rule_"


def get_scheduler():
    from app.services import scheduler_setup

    return scheduler_setup.scheduler


def unregister_recurrence_job(rule_id: int) -> None:
    sched = get_scheduler()
    if not sched:
        return
    job_id = f"{JOB_PREFIX}{rule_id}"
    try:
        sched.remove_job(job_id)
    except JobLookupError:
        pass


def register_recurrence_job(rule: SessionRecurrenceRule) -> None:
    sched = get_scheduler()
    if not sched:
        return
    job_id = f"{JOB_PREFIX}{rule.id}"
    if not rule.is_active:
        unregister_recurrence_job(rule.id)
        return
    try:
        ZoneInfo(rule.announce_timezone)
        ZoneInfo(rule.timezone)
    except ZoneInfoNotFoundError:
        logger.error(
            "Invalid timezone on recurrence rule %s (announce=%r kickoff=%r)",
            rule.id,
            rule.announce_timezone,
            rule.timezone,
        )
        return

    from app.services.jobs import run_recurrence_rule_job

    sched.add_job(
        run_recurrence_rule_job,
        CronTrigger(
            day_of_week=rule.announce_weekday,
            hour=rule.announce_hour,
            minute=rule.announce_minute,
            timezone=rule.announce_timezone,
        ),
        id=job_id,
        args=[rule.id],
        replace_existing=True,
        misfire_grace_time=3600,
    )
    logger.info(
        "Scheduled recurrence job %s at %s weekday=%s %02d:%02d",
        job_id,
        rule.announce_timezone,
        rule.announce_weekday,
        rule.announce_hour,
        rule.announce_minute,
    )


async def sync_recurrence_jobs_from_db() -> None:
    """Remove jobs for inactive rules; register weekly cron for each active rule."""
    async with async_session() as db:
        result = await db.execute(select(SessionRecurrenceRule))
        rules = result.scalars().all()

    sched = get_scheduler()
    if not sched:
        return

    active_ids = {r.id for r in rules if r.is_active}
    for job in sched.get_jobs():
        if not job.id.startswith(JOB_PREFIX):
            continue
        try:
            rid = int(job.id.replace(JOB_PREFIX, "", 1))
        except ValueError:
            continue
        if rid not in active_ids:
            try:
                sched.remove_job(job.id)
                logger.info("Removed stale recurrence job %s", job.id)
            except JobLookupError:
                pass

    for rule in rules:
        if rule.is_active:
            register_recurrence_job(rule)
