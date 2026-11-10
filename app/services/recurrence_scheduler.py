"""Two APScheduler cron jobs per active game template:

- materialize: creates the next kickoff row at end-of-meetup-day (midnight of
  the day after the kickoff, in the LOCATION timezone), so the admin overview
  always has a next meetup to manage;
- announce: sends sign-up invites at the template's announce_* wall time.
"""

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
MATERIALIZE_JOB_PREFIX = "game_template_materialize_"


def get_scheduler():
    from app.services import scheduler_setup

    return scheduler_setup.scheduler


def _remove(job_id: str) -> None:
    sched = get_scheduler()
    if not sched:
        return
    try:
        sched.remove_job(job_id)
    except JobLookupError:
        pass


def unregister_game_template_job(template_id: int) -> None:
    _remove(f"{JOB_PREFIX}{template_id}")
    _remove(f"{MATERIALIZE_JOB_PREFIX}{template_id}")


def register_game_template_job(template: GameTemplate) -> None:
    sched = get_scheduler()
    if not sched:
        return
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

    # Materialize the next kickoff at midnight ending the meetup day
    # (location tz), so the week ahead is always visible to the admin.
    from app.services.jobs import run_game_template_materialize_job

    sched.add_job(
        run_game_template_materialize_job,
        CronTrigger(
            day_of_week=(template.weekday + 1) % 7,
            hour=0,
            minute=0,
            timezone=template.timezone,
        ),
        id=f"{MATERIALIZE_JOB_PREFIX}{template.id}",
        args=[template.id],
        replace_existing=True,
        misfire_grace_time=3600,
    )

    from app.services.jobs import run_game_template_announce_job

    sched.add_job(
        run_game_template_announce_job,
        CronTrigger(
            day_of_week=template.announce_weekday,
            hour=template.announce_hour,
            minute=template.announce_minute,
            timezone=template.announce_timezone,
        ),
        id=f"{JOB_PREFIX}{template.id}",
        args=[template.id],
        replace_existing=True,
        misfire_grace_time=3600,
    )
    logger.info(
        "Scheduled game template %s: materialize at 00:00 after weekday=%s (%s), "
        "announce weekday=%s %02d:%02d (%s)",
        template.id,
        template.weekday,
        template.timezone,
        template.announce_weekday,
        template.announce_hour,
        template.announce_minute,
        template.announce_timezone,
    )


async def sync_game_template_jobs_from_db() -> None:
    """Remove jobs for inactive templates; register crons for each active one."""
    async with async_session() as db:
        result = await db.execute(select(GameTemplate))
        templates = result.scalars().all()

    sched = get_scheduler()
    if not sched:
        return

    active_ids = {t.id for t in templates if t.is_active}
    for job in sched.get_jobs():
        if not job.id.startswith("game_template"):
            continue
        raw = job.id
        for prefix in (MATERIALIZE_JOB_PREFIX, JOB_PREFIX):
            if raw.startswith(prefix):
                raw = raw[len(prefix):]
                break
        try:
            tid = int(raw)
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
