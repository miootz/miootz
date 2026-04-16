import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

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
    logger.info(
        "Scheduler started (%s); recurrence rules register their own weekly jobs",
        settings.SCHEDULER_TIMEZONE,
    )
    return scheduler


def shutdown_scheduler() -> None:
    global scheduler
    if scheduler:
        scheduler.shutdown(wait=False)
        scheduler = None
