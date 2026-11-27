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
    from app.services.jobs import run_job_queue_poll, run_kickoff_reminder_job

    scheduler.add_job(
        run_kickoff_reminder_job,
        IntervalTrigger(minutes=1),
        id="kickoff_reminders_1h",
        replace_existing=True,
    )
    scheduler.add_job(
        run_job_queue_poll,
        IntervalTrigger(seconds=5),
        id="job_queue_poll",
        replace_existing=True,
    )
    from app.services.player_progress import record_due_rating_snapshots

    scheduler.add_job(
        record_due_rating_snapshots,
        IntervalTrigger(minutes=1),
        id="capture_meetup_ratings",
        replace_existing=True,
    )
    from app.services.audit import prune_audit_log

    scheduler.add_job(
        prune_audit_log,
        IntervalTrigger(hours=1),
        args=[settings.AUDIT_RETENTION_DAYS],
        id="audit_prune",
        replace_existing=True,
    )
    logger.info(
        "Scheduler started (%s); kickoff 1h reminders every 1m; durable job queue polled every 5s; audit log pruned hourly; game templates register weekly jobs; rating reminders queued per-meetup",
        settings.SCHEDULER_TIMEZONE,
    )
    return scheduler


def shutdown_scheduler() -> None:
    global scheduler
    if scheduler:
        scheduler.shutdown(wait=False)
        scheduler = None
