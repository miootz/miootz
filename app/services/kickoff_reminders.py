"""One-shot Web Push reminders ~1 hour before session kickoff (scheduler-driven)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import GameSession
from app.services.web_push import notify_kickoff_reminder_for_session

logger = logging.getLogger(__name__)


async def scan_and_send_kickoff_reminders(db: AsyncSession) -> int:
    """
    Sessions whose start_time falls in [now+59m, now+61m] (UTC) and that have not
    yet received the kickoff reminder get one Web Push to all non-cancelled attendees.
    """
    now = datetime.now(timezone.utc)
    lo = (now + timedelta(minutes=59)).replace(tzinfo=None)
    hi = (now + timedelta(minutes=61)).replace(tzinfo=None)

    result = await db.execute(
        select(GameSession).where(
            GameSession.kickoff_reminder_sent_at.is_(None),
            GameSession.start_time >= lo,
            GameSession.start_time <= hi,
        )
    )
    sessions = result.scalars().all()
    if not sessions:
        return 0

    sent = 0
    for session in sessions:
        try:
            await notify_kickoff_reminder_for_session(db, session)
            session.kickoff_reminder_sent_at = datetime.now(timezone.utc).replace(
                tzinfo=None
            )
            sent += 1
            logger.info(
                "Kickoff reminder sent for session_id=%s start=%s",
                session.id,
                session.start_time,
            )
        except Exception as e:
            logger.exception(
                "Kickoff reminder failed for session_id=%s: %s", session.id, e
            )

    await db.commit()
    return sent
