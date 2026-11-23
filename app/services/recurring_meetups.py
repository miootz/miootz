"""Weekly templates: next kickoff meetup + push notifications at a scheduled wall time."""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, UTC
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.timeutil import to_utc
from app.core.database import async_session
from app.models.game_template import GameTemplate
from app.models.meetup import Meetup
from app.models.user import User
from app.services.template_subscriptions import filter_users_by_template_subscription
from app.services.web_push import notify_new_meetup_invites
from app.services.meetup_revision import notify_meetup_list_changed

logger = logging.getLogger(__name__)


def next_occurrence_utc(template: GameTemplate, after_utc: datetime) -> datetime | None:
    """First meetup start at or after `after_utc` (UTC) matching the template kickoff wall time."""
    try:
        z = ZoneInfo(template.timezone)
    except ZoneInfoNotFoundError:
        logger.warning(
            "Invalid timezone %r on game template %s", template.timezone, template.id
        )
        return None

    if after_utc.tzinfo is None:
        after_utc = after_utc.replace(tzinfo=UTC)
    loc = after_utc.astimezone(z)
    loc_date = loc.date()

    for i in range(370):
        d = loc_date + timedelta(days=i)
        if d.weekday() != template.weekday:
            continue
        cand = datetime.combine(d, time(template.hour, template.minute), tzinfo=z)
        if cand > loc:
            return cand.astimezone(UTC)

    return None


def prev_occurrence_utc(template: GameTemplate, before_utc: datetime) -> datetime | None:
    """Most recent meetup start strictly before `before_utc` (UTC) matching the template kickoff wall time."""
    try:
        z = ZoneInfo(template.timezone)
    except ZoneInfoNotFoundError:
        return None

    if before_utc.tzinfo is None:
        before_utc = before_utc.replace(tzinfo=UTC)
    loc = before_utc.astimezone(z)
    loc_date = loc.date()

    for i in range(370):
        d = loc_date - timedelta(days=i)
        if d.weekday() != template.weekday:
            continue
        cand = datetime.combine(d, time(template.hour, template.minute), tzinfo=z)
        if cand < loc:
            return cand.astimezone(UTC)

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
        after_utc = after_utc.replace(tzinfo=UTC)
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
            return cand.astimezone(UTC)

    return None


async def _create_template_meetup(
    db, template: GameTemplate, t: datetime
) -> "Meetup | None":
    """Create a meetup row for kickoff instant `t`; None if one already exists."""
    # Team count follows the max_players heuristic (see migrations backfill).
    from app.services.manual_teams import ensure_team_names

    meetup = Meetup(
        start_time=t,
        location=template.location,
        fee=template.fee,
        fee_text=template.fee_text,
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
    ensure_team_names(meetup, 3 if (meetup.max_players or 15) >= 13 else 2)
    db.add(meetup)
    try:
        await db.commit()
    except IntegrityError:
        # uq_meetup_template_start: a concurrent poller took the slot first.
        await db.rollback()
        return None
    await db.refresh(meetup)
    await notify_meetup_list_changed()

    # Queue rating reminder at meetup end time (durable job queue)
    from app.services.rating_reminder_scheduler import register_rating_reminder

    await register_rating_reminder(db, meetup)
    return meetup


async def materialize_next_meetup(template_id: int) -> bool:
    """Create the next kickoff row if missing (details from the template).

    Idempotent for that kickoff instant. Returns True if a new row was created.
    No push — notification is a separate concern (see notify_new_meetup).
    """
    async with async_session() as db:
        template = await db.get(GameTemplate, template_id)
        if not template or not template.is_active:
            return False

        now = datetime.now(UTC)
        t = next_occurrence_utc(template, now - timedelta(seconds=1))
        if t is None:
            return False

        # Missed-week backfill: if the most recent past kickoff has no row
        # and no newer meetup exists for this template, recreate it so a
        # downed server doesn't silently drop the week. No push — the slot
        # is already in the past.
        last_existing = (
            await db.execute(
                select(func.max(Meetup.start_time)).where(
                    Meetup.game_template_id == template.id
                )
            )
        ).scalar_one_or_none()
        prev = prev_occurrence_utc(template, now)
        if (
            prev is not None
            and (last_existing is None or prev > to_utc(last_existing))
        ):
            if await _create_template_meetup(db, template, prev) is not None:
                logger.info(
                    "Game template %s: backfilled missed meetup at %s",
                    template_id,
                    prev.isoformat(),
                )

        meetup = await _create_template_meetup(db, template, t)
        if meetup is None:
            return False

        logger.info(
            "Game template %s: created meetup %s at %s",
            template_id,
            meetup.id,
            t.isoformat(),
        )
        return True


async def notify_new_meetup(template_id: int) -> bool:
    """Push sign-up invites for the template's next materialized meetup.

    Sends to subscribers only. Returns True if invites went out.
    """
    async with async_session() as db:
        template = await db.get(GameTemplate, template_id)
        if not template or not template.is_active:
            return False

        now = datetime.now(UTC).replace(tzinfo=None)
        row = (
            await db.execute(
                select(Meetup)
                .where(
                    Meetup.game_template_id == template_id,
                    Meetup.skipped.is_(False),
                    Meetup.start_time >= now,
                )
                .order_by(Meetup.start_time.asc())
            )
        ).scalars().first()
        if row is None:
            return False

        result = await db.execute(select(User))
        all_users = result.scalars().all()
        if not all_users:
            return False
        ids = [u.id for u in all_users]
        allowed = set(await filter_users_by_template_subscription(db, ids, template.id))
        recipients = [u for u in all_users if u.id in allowed]
        if not recipients:
            return False
        await notify_new_meetup_invites(db, row, recipients)
        logger.info(
            "Game template %s: sign-up invites sent for meetup %s to %d user(s)",
            template_id,
            row.id,
            len(recipients),
        )
        return True


async def materialize_next_meetup_and_notify(template_id: int) -> bool:
    """Create the next kickoff row if missing, then send sign-up invites.

    Kept for callers that want both in one shot (admin run-now, tests).
    Returns True if a new meetup row was created.
    """
    created = await materialize_next_meetup(template_id)
    await notify_new_meetup(template_id)
    return created
