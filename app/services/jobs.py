import logging

from app.core.database import async_session
from app.services.recurring_sessions import materialize_next_session_and_notify
from app.services.kickoff_reminders import scan_and_send_kickoff_reminders

logger = logging.getLogger(__name__)


async def run_kickoff_reminder_job() -> None:
    """Every minute: Web Push to attendees ~1 hour before kickoff (once per session)."""
    async with async_session() as db:
        n = await scan_and_send_kickoff_reminders(db)
        if n:
            logger.info("Kickoff 1h reminders: %s session(s)", n)


async def run_game_template_job(template_id: int) -> None:
    """Weekly cron: create next kickoff if missing, then send join-link emails."""
    created = await materialize_next_session_and_notify(template_id)
    logger.info(
        "Game template job template_id=%s created_session=%s",
        template_id,
        created,
    )
