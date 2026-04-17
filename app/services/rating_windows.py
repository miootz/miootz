"""Rating time windows: open after session start; editable until next session starts."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import GameSession


def to_utc_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def next_session_start_after(
    db: AsyncSession, session: GameSession
) -> datetime | None:
    result = await db.execute(
        select(GameSession.start_time)
        .where(GameSession.start_time > session.start_time)
        .order_by(GameSession.start_time.asc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    return row if row is None else to_utc_aware(row)


def ratings_locked(
    now: datetime, session: GameSession, next_session_start: datetime | None
) -> bool:
    """True when edits are no longer allowed (after next session kickoff)."""
    if next_session_start is None:
        return False
    return now >= to_utc_aware(next_session_start)


def may_rate_or_edit(
    now: datetime,
    session: GameSession,
    next_session_start: datetime | None,
) -> tuple[bool, str | None]:
    if now < to_utc_aware(session.start_time):
        return False, "Session has not started yet"
    if ratings_locked(now, session, next_session_start):
        return False, "Ratings for this session are locked"
    return True, None
