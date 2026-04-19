"""One APScheduler cron job per active game template (weekly at announce_* wall time)."""

from __future__ import annotations

import logging
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.jobstores.base import JobLookupError
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from app.core.database import async_session
from app.models.game_template import GameTemplate

logger = logging.getLogger(__name__)

JOB_PREFIX = "game_template_"


def get_scheduler():
    from app.services import scheduler_setup

    return scheduler_setup.scheduler


def unregister_game_template_job(template_id: int) -> None:
    sched = get_scheduler()
    if not sched:
        return
    job_id = f"{JOB_PREFIX}{template_id}"
    try:
        sched.remove_job(job_id)
    except JobLookupError:
        pass


def register_game_template_job(template: GameTemplate) -> None:
    sched = get_scheduler()
    if not sched:
        return
    job_id = f"{JOB_PREFIX}{template.id}"
    if not template.is_active:
        unregister_game_template_job(template.id)
        return
    try:
        ZoneInfo(template.announce_timezone)
        ZoneInfo(template.timezone)
    except ZoneInfoNotFoundError:
        logger.error(
            "Invalid timezone on game template %s (announce=%r kickoff=%r)",
            template.id,
            template.announce_timezone,
            template.timezone,
        )
        return

    from app.services.jobs import run_game_template_job

    sched.add_job(
        run_game_template_job,
        CronTrigger(
            day_of_week=template.announce_weekday,
            hour=template.announce_hour,
            minute=template.announce_minute,
            timezone=template.announce_timezone,
        ),
        id=job_id,
        args=[template.id],
        replace_existing=True,
        misfire_grace_time=3600,
    )
    logger.info(
        "Scheduled game template job %s at %s weekday=%s %02d:%02d",
        job_id,
        template.announce_timezone,
        template.announce_weekday,
        template.announce_hour,
        template.announce_minute,
    )


async def sync_game_template_jobs_from_db() -> None:
    """Remove jobs for inactive templates; register weekly cron for each active template."""
    async with async_session() as db:
        result = await db.execute(select(GameTemplate))
        templates = result.scalars().all()

    sched = get_scheduler()
    if not sched:
        return

    active_ids = {t.id for t in templates if t.is_active}
    for job in sched.get_jobs():
        if not job.id.startswith(JOB_PREFIX):
            continue
        try:
            tid = int(job.id.replace(JOB_PREFIX, "", 1))
        except ValueError:
            continue
        if tid not in active_ids:
            try:
                sched.remove_job(job.id)
            except JobLookupError:
                pass

    for t in templates:
        if t.is_active:
            register_game_template_job(t)
