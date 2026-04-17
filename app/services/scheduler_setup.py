import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.core.config import settings

logger = logging.getLogger(__name__)

scheduler: AsyncIOScheduler | None = None


def start_scheduler() -> AsyncIOScheduler | None:
    global scheduler
    if not settings.SCHEDULER_ENABLED:
        logger.info("Scheduler disabled via SCHEDULER_ENABLED=0")
        return None

    scheduler = AsyncIOScheduler(timezone=settings.SCHEDULER_TIMEZONE)
    scheduler.start()
    from app.services.jobs import run_kickoff_reminder_job

    scheduler.add_job(
        run_kickoff_reminder_job,
        IntervalTrigger(minutes=1),
        id="kickoff_reminders_1h",
        replace_existing=True,
    )
    logger.info(
        "Scheduler started (%s); kickoff 1h reminders every 1m; recurrence rules register weekly jobs",
        settings.SCHEDULER_TIMEZONE,
    )
    return scheduler


def shutdown_scheduler() -> None:
    global scheduler
    if scheduler:
        scheduler.shutdown(wait=False)
        scheduler = None
