"""Shared auth dependencies.

Three tiers:
- ``require_admin``                    — admin console endpoints.
- ``require_present_member``           — "steward" gate for live match
  mutations (plan §7): the caller must have ``attendance.status ==
  "confirmed"`` for the meetup AND the request must land inside the presence
  window ``[start_time - 15 min, start_time + duration + 30 min]``.
- ``require_admin_or_present_member``  — live match CRUD: admin at all
  times, attending (present) members inside the window.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import utcnow
from app.models.meetup import Attendance, Meetup

#: Presence window head/tail (plan §7).
PRESENCE_HEAD_MINUTES = 15
PRESENCE_TAIL_MINUTES = 30
#: Fallback meetup length when the admin never set ``duration_minutes``.
DEFAULT_MEETUP_DURATION_MINUTES = 120


def _presence_window(meetup: Meetup) -> tuple[datetime, datetime]:
    """(window_open, window_close) as naive-UTC datetimes."""
    start = meetup.start_time
    if start.tzinfo is not None:  # defensive: normalize to naive UTC storage
        offset = start.utcoffset() or timedelta(0)
        start = (start - offset).replace(tzinfo=None)
    duration = meetup.duration_minutes or DEFAULT_MEETUP_DURATION_MINUTES
    return (
        start - timedelta(minutes=PRESENCE_HEAD_MINUTES),
        start + timedelta(minutes=duration + PRESENCE_TAIL_MINUTES),
    )


async def presence_for_meetup(
    db: AsyncSession, meetup_id: int, user
) -> tuple[bool, str]:
    """Return ``(can_control, reason)`` — reason is one of:
    ``meetup_not_found`` | ``not_attending`` | ``outside_window`` | ``ok``.
    """
    meetup = await db.get(Meetup, meetup_id)
    if meetup is None:
        return False, "meetup_not_found"
    att = (
        await db.execute(
            select(Attendance).where(
                Attendance.meetup_id == meetup_id,
                Attendance.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if att is None or att.status != "confirmed":
        return False, "not_attending"
    window_open, window_close = _presence_window(meetup)
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
    sid = request.path_params.get("meetup_id")
    if sid is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="require_present_member used on a path without {meetup_id}",
        )
    ok, reason = await presence_for_meetup(db, int(sid), user)
    if not ok:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)
    return user


async def require_admin_or_present_member(
    request: Request, db: AsyncSession = Depends(get_db)
):
    """Gate for live-match CRUD: admin always, else present member (plan §7).

    Attending players get full match CRUD (matches, score, teams, penalty,
    goals, timer) while the presence window is open; admins keep it at all
    times.
    """
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    if getattr(request.state, "is_admin", False):
        return user
    sid = request.path_params.get("meetup_id")
    if sid is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="require_admin_or_present_member used on a path without {meetup_id}",
        )
    ok, reason = await presence_for_meetup(db, int(sid), user)
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
