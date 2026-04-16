import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.services.jobs import weekly_session_reminder_job

logger = logging.getLogger(__name__)

scheduler: AsyncIOScheduler | None = None


def start_scheduler() -> AsyncIOScheduler | None:
    global scheduler
    if not settings.SCHEDULER_ENABLED:
        logger.info("Scheduler disabled via SCHEDULER_ENABLED=0")
        return None

    scheduler = AsyncIOScheduler(timezone=settings.SCHEDULER_TIMEZONE)
    # weekday: mon=0 … sun=6 (matches Python datetime.weekday())
    scheduler.add_job(
        weekly_session_reminder_job,
        CronTrigger(
            day_of_week=settings.REMINDER_WEEKDAY,
            hour=settings.REMINDER_HOUR,
            minute=settings.REMINDER_MINUTE,
        ),
        id="weekly_session_reminder",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        "Scheduler started: reminder on weekday=%s at %02d:%02d (%s)",
        settings.REMINDER_WEEKDAY,
        settings.REMINDER_HOUR,
        settings.REMINDER_MINUTE,
        settings.SCHEDULER_TIMEZONE,
    )
    return scheduler


def shutdown_scheduler() -> None:
    global scheduler
    if scheduler:
        scheduler.shutdown(wait=False)
        scheduler = None
