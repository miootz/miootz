"""Weekly recurrence: next kickoff session + invite emails at a scheduled wall time."""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.models.session import GameSession
from app.models.session_recurrence import SessionRecurrenceRule
from app.models.user import User
from app.services.notifications import notify_new_session_invites

logger = logging.getLogger(__name__)


def utc_start_matches_rule(
    start_utc: datetime,
    timezone_name: str,
    weekday: int,
    hour: int,
    minute: int,
) -> bool:
    """True if `start_utc` falls on the given weekday at hour:minute wall time in `timezone_name`."""
    try:
        z = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return False
    if start_utc.tzinfo is None:
        start_utc = start_utc.replace(tzinfo=timezone.utc)
    local = start_utc.astimezone(z)
    return (
        local.weekday() == weekday
        and local.hour == hour
        and local.minute == minute
    )


def next_occurrence_utc(rule: SessionRecurrenceRule, after_utc: datetime) -> datetime | None:
    """First session start at or after `after_utc` (UTC) matching the rule's kickoff wall time."""
    try:
        z = ZoneInfo(rule.timezone)
    except ZoneInfoNotFoundError:
        logger.warning("Invalid timezone %r on recurrence rule %s", rule.timezone, rule.id)
        return None

    if after_utc.tzinfo is None:
        after_utc = after_utc.replace(tzinfo=timezone.utc)
    loc = after_utc.astimezone(z)
    loc_date = loc.date()

    for i in range(370):
        d = loc_date + timedelta(days=i)
        if d.weekday() != rule.weekday:
            continue
        cand = datetime.combine(d, time(rule.hour, rule.minute), tzinfo=z)
        if cand > loc:
            return cand.astimezone(timezone.utc)

    return None


async def materialize_next_session_and_notify(rule_id: int) -> bool:
    """
    If the next weekly kickoff slot has no session row yet, create it (details from the rule)
    and email all users with join links. Idempotent for that kickoff instant.
    Returns True if a new session row was created.
    """
    async with async_session() as db:
        rule = await db.get(SessionRecurrenceRule, rule_id)
        if not rule or not rule.is_active:
            return False

        now = datetime.now(timezone.utc)
        t = next_occurrence_utc(rule, now - timedelta(seconds=1))
        if t is None:
            return False

        exists = await db.execute(
            select(GameSession.id)
            .where(
                GameSession.recurrence_rule_id == rule.id,
                GameSession.start_time == t,
            )
            .limit(1)
        )
        if exists.scalar_one_or_none() is not None:
            return False

        session = GameSession(
            start_time=t,
            location=rule.location,
            fee=rule.fee,
            min_players=rule.min_players,
            max_players=rule.max_players,
            latitude=rule.latitude,
            longitude=rule.longitude,
            waitlist_mode=rule.waitlist_mode,
            team_assignment_mode=getattr(rule, "team_assignment_mode", None)
            or "balanced",
            recurrence_rule_id=rule.id,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)

        result = await db.execute(select(User))
        recipients = [u for u in result.scalars().all() if u.email]
        if recipients:
            await notify_new_session_invites(session, recipients)

        logger.info(
            "Recurrence rule %s: created session %s at %s",
            rule_id,
            session.id,
            t.isoformat(),
        )
        return True
