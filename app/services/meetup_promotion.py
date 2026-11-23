"""When a confirmed spot opens, either auto-promote or broadcast to waitlist."""

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.services.meetup_revision import (
    bump_meetup_revision,
    notify_meetup_data_changed,
)
from app.services.team_adjustment import redraft_after_waitlist_promotion
from app.services.web_push import notify_auto_promoted, notify_broadcast_spot_open


async def handle_spot_opened(db: AsyncSession, meetup: Meetup) -> None:
    """Call after a confirmed player leaves or cancels (attendance row updated/deleted)."""
    waitlist = (
        select(Attendance.id)
        .where(Attendance.meetup_id == meetup.id, Attendance.status == "waitlisted")
        .order_by(Attendance.joined_at, Attendance.id)
    )
    mode = (meetup.waitlist_mode or "auto_promote").lower()
    if mode == "broadcast":
        users = (await db.scalars(
            select(User).join(Attendance).where(Attendance.id.in_(waitlist))
        )).all()
        if users:
            await notify_broadcast_spot_open(db, meetup, list(users))
        return

    promoted_id = await db.scalar(
        update(Attendance)
        .where(Attendance.id == waitlist.limit(1).scalar_subquery())
        .values(status="confirmed")
        .returning(Attendance.user_id)
    )
    if promoted_id is None:
        return
    await db.refresh(meetup)
    await redraft_after_waitlist_promotion(db, meetup)
    rev = await bump_meetup_revision(db, meetup.id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup.id, rev)
    promoted = await db.get(User, promoted_id)
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
