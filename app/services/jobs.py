import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session
from app.models.session import GameSession
from app.models.user import User
from app.services.notifications import notify_session_reminder

logger = logging.getLogger(__name__)


async def weekly_session_reminder_job() -> None:
    """Pick the next upcoming session and email all users (with email set)."""
    async with async_session() as db:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(GameSession)
            .where(GameSession.start_time > now)
            .order_by(GameSession.start_time.asc())
            .limit(1)
        )
        session = result.scalar_one_or_none()
        if not session:
            logger.info("No upcoming sessions — reminder skipped")
            return

        result = await db.execute(select(User))
        users = result.scalars().all()
        recipients = [u for u in users if u.email]
        if not recipients:
            logger.warning("No users with email — reminder skipped")
            return

        await notify_session_reminder(session, recipients)
        logger.info(
            "Reminder sent for session %s to %d recipients",
            session.id,
            len(recipients),
        )
