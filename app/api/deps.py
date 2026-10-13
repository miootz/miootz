"""Shared auth dependencies.

Two tiers:
- ``require_admin``   — admin console endpoints.
- ``require_present_member`` — "steward" gate for live match mutations
  (plan §7): the caller must have ``attendance.status == "confirmed"`` for
  the session AND the request must land inside the presence window
  ``[start_time - 15 min, start_time + duration + 30 min]``.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import utcnow
from app.models.session import Attendance, GameSession

#: Presence window head/tail (plan §7).
PRESENCE_HEAD_MINUTES = 15
PRESENCE_TAIL_MINUTES = 30
#: Fallback session length when the admin never set ``duration_minutes``.
DEFAULT_SESSION_DURATION_MINUTES = 120


def _presence_window(session: GameSession) -> tuple[datetime, datetime]:
    """(window_open, window_close) as naive-UTC datetimes."""
    start = session.start_time
    if start.tzinfo is not None:  # defensive: normalize to naive UTC storage
        offset = start.utcoffset() or timedelta(0)
        start = (start - offset).replace(tzinfo=None)
    duration = session.duration_minutes or DEFAULT_SESSION_DURATION_MINUTES
    return (
        start - timedelta(minutes=PRESENCE_HEAD_MINUTES),
        start + timedelta(minutes=duration + PRESENCE_TAIL_MINUTES),
    )


async def presence_for_session(
    db: AsyncSession, session_id: int, user
) -> tuple[bool, str]:
    """Return ``(can_control, reason)`` — reason is one of:
    ``session_not_found`` | ``not_attending`` | ``outside_window`` | ``ok``.
    """
    session = await db.get(GameSession, session_id)
    if session is None:
        return False, "session_not_found"
    att = (
        await db.execute(
            select(Attendance).where(
                Attendance.session_id == session_id,
                Attendance.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if att is None or att.status != "confirmed":
        return False, "not_attending"
    window_open, window_close = _presence_window(session)
    now = utcnow()
    if not (window_open <= now <= window_close):
        return False, "outside_window"
    return True, "ok"


async def require_present_member(request: Request, db: AsyncSession = Depends(get_db)):
    """Gate for live-match mutations: present member only (plan §7)."""
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    sid = request.path_params.get("session_id")
    if sid is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="require_present_member used on a path without {session_id}",
        )
    ok, reason = await presence_for_session(db, int(sid), user)
    if not ok:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)
    return user


def require_admin(request: Request):
    user = request.state.user
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    if not getattr(request.state, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return user
