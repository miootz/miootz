import logging

from app.core.database import async_session
from app.services.kickoff_reminders import scan_and_send_kickoff_reminders
from app.services.recurring_meetups import materialize_next_meetup_and_notify
from app.services.web_push import notify_rating_reminder_for_meetup
from app.core.timeutil import utcnow

logger = logging.getLogger(__name__)


async def record_meetup_weather(meetup_id: int) -> None:
    """Fetch current conditions from Open-Meteo and save to the meetup."""

    from app.models.meetup import Meetup

    async with async_session() as db:
        meetup = await db.get(Meetup, meetup_id)
        if not meetup:
            logger.info("Weather recording: meetup %s not found, skipping", meetup_id)
            return
        if meetup.latitude is None or meetup.longitude is None:
            logger.info(
                "Weather recording: meetup %s has no coordinates, skipping", meetup_id
            )
            return
        # Skip if already recorded
        if meetup.weather_actual_temp_c is not None:
            return

        from app.services.weather_service import fetch_current

        current = await fetch_current(meetup.latitude, meetup.longitude)
        if current is None:
            logger.warning(
                "Weather recording: Open-Meteo unavailable for meetup %s", meetup_id
            )
            return

        meetup.weather_actual_temp_c = current["temp_c"]
        meetup.weather_actual_code = current["weather_code"]
        meetup.weather_actual_label = current["label"]
        meetup.weather_actual_recorded_at = utcnow()

        await db.commit()
        logger.info(
            "Weather recorded for meetup %s: %.0f°C %s",
            meetup_id,
            current["temp_c"],
            current["label"],
        )


async def run_kickoff_reminder_job() -> None:
    """Every minute: Web Push to attendees ~1 hour before kickoff (once per meetup)."""
    async with async_session() as db:
        n = await scan_and_send_kickoff_reminders(db)
        if n:
            logger.info("Kickoff 1h reminders: %s meetup(s)", n)


async def run_job_queue_poll() -> None:
    """Every 30s: run due one-shot jobs from the durable job_queue table."""
    from app.services.job_queue import run_due_jobs

    n = await run_due_jobs()
    if n:
        logger.info("Job queue: %s job(s) processed", n)


async def send_rating_reminder_for_meetup(meetup_id: int) -> None:
    """One-shot job: fire at meetup end time, push confirmed attendees to rate peers
    and record actual weather conditions."""
    # Record weather first (uses its own DB meetup)
    try:
        await record_meetup_weather(meetup_id)
    except Exception:
        logger.exception("Weather recording failed for meetup %s", meetup_id)

    async with async_session() as db:
        from app.models.meetup import Meetup

        meetup = await db.get(Meetup, meetup_id)
        if not meetup:
            logger.info(
                "Rating reminder job: meetup %s not found, skipping", meetup_id
            )
            return
        try:
            await notify_rating_reminder_for_meetup(db, meetup)
            logger.info("Rating reminder sent for meetup %s", meetup_id)
        except Exception as e:
            logger.exception("Rating reminder failed for meetup %s: %s", meetup_id, e)


async def run_game_template_job(template_id: int) -> None:
    """Weekly cron: create next kickoff if missing, then send push notifications."""
    created = await materialize_next_meetup_and_notify(template_id)
    logger.info(
        "Game template job template_id=%s created_meetup=%s",
        template_id,
        created,
    )
