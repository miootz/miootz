"""One-shot Web Push reminders ~1 hour before meetup kickoff (scheduler-driven)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, UTC

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meetup import Meetup
from app.services.web_push import notify_kickoff_reminder_for_meetup

logger = logging.getLogger(__name__)


async def scan_and_send_kickoff_reminders(db: AsyncSession) -> int:
    """
    Meetups whose start_time falls in [now+59m, now+61m] (UTC) and that have not
    yet received the kickoff reminder get one Web Push to all non-cancelled attendees.
    """
    now = datetime.now(UTC)
    lo = (now + timedelta(minutes=59)).replace(tzinfo=None)
    hi = (now + timedelta(minutes=61)).replace(tzinfo=None)

    result = await db.execute(
        select(Meetup).where(
            Meetup.kickoff_reminder_sent_at.is_(None),
            Meetup.start_time >= lo,
            Meetup.start_time <= hi,
        )
    )
    meetups = result.scalars().all()
    if not meetups:
        return 0

    sent = 0
    for meetup in meetups:
        try:
            await notify_kickoff_reminder_for_meetup(db, meetup)
            meetup.kickoff_reminder_sent_at = datetime.now(UTC).replace(tzinfo=None)
            sent += 1
            logger.info(
                "Kickoff reminder sent for meetup_id=%s start=%s",
                meetup.id,
                meetup.start_time,
            )
        except Exception as e:
            logger.exception(
                "Kickoff reminder failed for meetup_id=%s: %s", meetup.id, e
            )

    await db.commit()
    return sent
