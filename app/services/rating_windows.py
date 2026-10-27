"""Rating time windows: open after meetup ends; editable until next meetup starts."""

from __future__ import annotations

from datetime import datetime, timedelta, UTC

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meetup import Meetup

#: Default meetup length in minutes when `duration_minutes` is not set.
_DEFAULT_DURATION_MINUTES = 120


def to_utc_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def utc_now() -> datetime:
    return datetime.now(UTC)


def meetup_end_time(meetup: Meetup) -> datetime:
    """Calculate meetup end time from start_time + duration_minutes.

    Falls back to 120 minutes when duration_minutes is not set.
    """
    duration = meetup.duration_minutes or _DEFAULT_DURATION_MINUTES
    return to_utc_aware(meetup.start_time) + timedelta(minutes=duration)


async def next_meetup_start_after(
    db: AsyncSession, meetup: Meetup
) -> datetime | None:
    result = await db.execute(
        select(Meetup.start_time)
        .where(Meetup.start_time > meetup.start_time)
        .order_by(Meetup.start_time.asc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    return row if row is None else to_utc_aware(row)


def ratings_locked(
    now: datetime, meetup: Meetup, next_meetup_start: datetime | None
) -> bool:
    """True when edits are no longer allowed (after next meetup kickoff)."""
    if next_meetup_start is None:
        return False
    return now >= to_utc_aware(next_meetup_start)


def may_rate_or_edit(
    now: datetime,
    meetup: Meetup,
    next_meetup_start: datetime | None,
) -> tuple[bool, str | None]:
    end = meetup_end_time(meetup)
    if now < end:
        return False, "Ratings open after the meetup ends"
    if ratings_locked(now, meetup, next_meetup_start):
        return False, "Ratings for this meetup are locked"
    return True, None
