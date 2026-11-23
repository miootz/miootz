"""When a confirmed spot opens, either auto-promote or broadcast to waitlist."""

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.core.timeutil import utcnow
from app.services.meetup_signup import active_hold_times
from app.services.meetup_revision import (
    bump_meetup_revision,
    notify_meetup_data_changed,
)
from app.services.team_adjustment import redraft_before_first_match
from app.services.web_push import notify_auto_promoted, notify_broadcast_spot_open


async def handle_spot_opened(db: AsyncSession, meetup: Meetup, *, queue_changed: bool = False) -> None:
    """Fill available capacity without passing an earlier signup hold."""
    # Acquire the write reservation before reading capacity or the queue.
    await db.execute(update(Meetup).where(Meetup.id == meetup.id).values(
        content_revision=Meetup.content_revision
    ))
    await db.refresh(meetup)
    confirmed = await db.scalar(select(func.count()).select_from(Attendance).where(
        Attendance.meetup_id == meetup.id, Attendance.status == "confirmed",
    ))
    holds = await active_hold_times(db, meetup.id, utcnow())
    waitlist = (
        select(Attendance)
        .where(Attendance.meetup_id == meetup.id, Attendance.status == "waitlisted")
        .order_by(Attendance.joined_at, Attendance.id)
    )
    mode = (meetup.waitlist_mode or "auto_promote").lower()
    promoted_ids = []
    if mode != "broadcast":
        for attendance in await db.scalars(waitlist):
            earlier_holds = sum(at < attendance.joined_at for at in holds)
            if confirmed + len(promoted_ids) + earlier_holds >= meetup.max_players:
                break
            attendance.status = "confirmed"
            promoted_ids.append(attendance.user_id)
        await db.flush()
    redrafted = await redraft_before_first_match(db, meetup)
    rev = await bump_meetup_revision(db, meetup.id) if queue_changed or promoted_ids or redrafted else None
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup.id, rev)
    if mode == "broadcast" and confirmed + len(holds) < meetup.max_players:
        users = (await db.scalars(
            select(User).join(Attendance).where(
                Attendance.meetup_id == meetup.id, Attendance.status == "waitlisted",
            )
        )).all()
        if users:
            await notify_broadcast_spot_open(db, meetup, list(users))
    for promoted_id in promoted_ids:
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
