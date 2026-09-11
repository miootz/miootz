import logging

from app.core.database import async_session
from app.services.kickoff_reminders import scan_and_send_kickoff_reminders
from app.services.recurring_sessions import materialize_next_session_and_notify
from app.services.web_push import notify_rating_reminder_for_session
from app.core.timeutil import utcnow

logger = logging.getLogger(__name__)


async def record_session_weather(session_id: int) -> None:
    """Fetch current conditions from Open-Meteo and save to the session."""

    from app.models.session import GameSession

    async with async_session() as db:
        session = await db.get(GameSession, session_id)
        if not session:
            logger.info("Weather recording: session %s not found, skipping", session_id)
            return
        if session.latitude is None or session.longitude is None:
            logger.info(
                "Weather recording: session %s has no coordinates, skipping", session_id
            )
            return
        # Skip if already recorded
        if session.weather_actual_temp_c is not None:
            return

        from app.services.weather_service import fetch_current

        current = await fetch_current(session.latitude, session.longitude)
        if current is None:
            logger.warning(
                "Weather recording: Open-Meteo unavailable for session %s", session_id
            )
            return

        session.weather_actual_temp_c = current["temp_c"]
        session.weather_actual_code = current["weather_code"]
        session.weather_actual_label = current["label"]
        session.weather_actual_recorded_at = utcnow()

        await db.commit()
        logger.info(
            "Weather recorded for session %s: %.0f°C %s",
            session_id,
            current["temp_c"],
            current["label"],
        )


async def run_kickoff_reminder_job() -> None:
    """Every minute: Web Push to attendees ~1 hour before kickoff (once per session)."""
    async with async_session() as db:
        n = await scan_and_send_kickoff_reminders(db)
        if n:
            logger.info("Kickoff 1h reminders: %s session(s)", n)


async def send_rating_reminder_for_session(session_id: int) -> None:
    """One-shot job: fire at session end time, push confirmed attendees to rate peers
    and record actual weather conditions."""
    # Record weather first (uses its own DB session)
    try:
        await record_session_weather(session_id)
    except Exception:
        logger.exception("Weather recording failed for session %s", session_id)

    async with async_session() as db:
        from app.models.session import GameSession

        session = await db.get(GameSession, session_id)
        if not session:
            logger.info(
                "Rating reminder job: session %s not found, skipping", session_id
            )
            return
        try:
            await notify_rating_reminder_for_session(db, session)
            logger.info("Rating reminder sent for session %s", session_id)
        except Exception as e:
            logger.exception("Rating reminder failed for session %s: %s", session_id, e)


async def run_game_template_job(template_id: int) -> None:
    """Weekly cron: create next kickoff if missing, then send push notifications."""
    created = await materialize_next_session_and_notify(template_id)
    logger.info(
        "Game template job template_id=%s created_session=%s",
        template_id,
        created,
    )
