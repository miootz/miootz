"""Weekly templates: next kickoff session + push notifications at a scheduled wall time."""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.models.game_template import GameTemplate
from app.models.session import GameSession
from app.models.user import User
from app.services.template_subscriptions import filter_users_by_template_subscription
from app.services.web_push import notify_new_session_invites

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


def next_occurrence_utc(
    template: GameTemplate, after_utc: datetime
) -> datetime | None:
    """First session start at or after `after_utc` (UTC) matching the template kickoff wall time."""
    try:
        z = ZoneInfo(template.timezone)
    except ZoneInfoNotFoundError:
        logger.warning(
            "Invalid timezone %r on game template %s", template.timezone, template.id
        )
        return None

    if after_utc.tzinfo is None:
        after_utc = after_utc.replace(tzinfo=timezone.utc)
    loc = after_utc.astimezone(z)
    loc_date = loc.date()

    for i in range(370):
        d = loc_date + timedelta(days=i)
        if d.weekday() != template.weekday:
            continue
        cand = datetime.combine(d, time(template.hour, template.minute), tzinfo=z)
        if cand > loc:
            return cand.astimezone(timezone.utc)

    return None


def next_announce_occurrence_utc(
    template: GameTemplate, after_utc: datetime
) -> datetime | None:
    """First *announce* run at or after `after_utc` (UTC) matching the template's announce wall time."""
    if template.announce_weekday is None:
        return None
    try:
        z = ZoneInfo(template.announce_timezone or template.timezone)
    except ZoneInfoNotFoundError:
        return None

    if after_utc.tzinfo is None:
        after_utc = after_utc.replace(tzinfo=timezone.utc)
    loc = after_utc.astimezone(z)
    loc_date = loc.date()

    for i in range(370):
        d = loc_date + timedelta(days=i)
        if d.weekday() != template.announce_weekday:
            continue
        cand = datetime.combine(
            d,
            time(template.announce_hour or 0, template.announce_minute or 0),
            tzinfo=z,
        )
        if cand > loc:
            return cand.astimezone(timezone.utc)

    return None


async def materialize_next_session_and_notify(template_id: int) -> bool:
    """
    If the next weekly kickoff slot has no session row yet, create it (details from the template)
    and email users who subscribe to this template. Idempotent for that kickoff instant.
    Returns True if a new session row was created.
    """
    async with async_session() as db:
        template = await db.get(GameTemplate, template_id)
        if not template or not template.is_active:
            return False

        now = datetime.now(timezone.utc)
        t = next_occurrence_utc(template, now - timedelta(seconds=1))
        if t is None:
            return False

        exists = await db.execute(
            select(GameSession.id)
            .where(
                GameSession.game_template_id == template.id,
                GameSession.start_time == t,
            )
            .limit(1)
        )
        if exists.scalar_one_or_none() is not None:
            return False

        session = GameSession(
            start_time=t,
            location=template.location,
            fee=template.fee,
            min_players=template.min_players,
            max_players=template.max_players,
            latitude=template.latitude,
            longitude=template.longitude,
            waitlist_mode=template.waitlist_mode,
            team_assignment_mode=getattr(template, "team_assignment_mode", None)
            or "balanced",
            game_template_id=template.id,
            match_duration_minutes=getattr(template, "match_duration_minutes", None)
            or 10,
        )
        # Auto-generate team names (default 3 teams for max_players=15)
        from app.services.manual_teams import ensure_team_names
        ensure_team_names(session, 3)
        db.add(session)
        await db.commit()
        await db.refresh(session)

        result = await db.execute(select(User))
        all_users = result.scalars().all()
        if all_users:
            ids = [u.id for u in all_users]
            allowed = set(
                await filter_users_by_template_subscription(db, ids, template.id)
            )
            recipients = [u for u in all_users if u.id in allowed]
            if recipients:
                await notify_new_session_invites(db, session, recipients)

        logger.info(
            "Game template %s: created session %s at %s",
            template_id,
            session.id,
            t.isoformat(),
        )

        # Schedule rating reminder at session end time
        from app.services.rating_reminder_scheduler import register_rating_reminder

        register_rating_reminder(session)
        return True
