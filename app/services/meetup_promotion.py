"""When a confirmed spot opens, either auto-promote or broadcast to waitlist."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.services.meetup_revision import (
    bump_meetup_revision,
    notify_meetup_data_changed,
)
from app.services.web_push import notify_auto_promoted, notify_broadcast_spot_open


async def handle_spot_opened(db: AsyncSession, meetup: Meetup) -> None:
    """Call after a confirmed player leaves or cancels (attendance row updated/deleted)."""
    result = await db.execute(
        select(Attendance)
        .where(
            Attendance.meetup_id == meetup.id,
            Attendance.status == "waitlisted",
        )
        .order_by(Attendance.joined_at.asc())
    )
    waitlisted = result.scalars().all()
    if not waitlisted:
        return

    mode = (meetup.waitlist_mode or "auto_promote").lower()
    if mode == "broadcast":
        users: list[User] = []
        for att in waitlisted:
            u = await db.get(User, att.user_id)
            if u:
                users.append(u)
        await notify_broadcast_spot_open(db, meetup, users)
        return

    # auto_promote: first waitlisted becomes confirmed
    first = waitlisted[0]
    first.status = "confirmed"
    rev = await bump_meetup_revision(db, meetup.id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup.id, rev)
    promoted = await db.get(User, first.user_id)
    if promoted:
        await notify_auto_promoted(db, meetup, promoted)


async def handle_leave_or_cancel(
    db: AsyncSession,
    meetup: Meetup,
    had_status: str,
) -> None:
    """had_status is the status before leave/cancel (confirmed or waitlisted)."""
    if had_status != "confirmed":
        return
    await handle_spot_opened(db, meetup)
