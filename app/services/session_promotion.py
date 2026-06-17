"""When a confirmed spot opens, either auto-promote or broadcast to waitlist."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import Attendance, GameSession
from app.models.user import User
from app.services.session_revision import (
    bump_session_revision,
    notify_session_data_changed,
)
from app.services.web_push import notify_auto_promoted, notify_broadcast_spot_open


async def handle_spot_opened(db: AsyncSession, session: GameSession) -> None:
    """Call after a confirmed player leaves or cancels (attendance row updated/deleted)."""
    result = await db.execute(
        select(Attendance)
        .where(
            Attendance.session_id == session.id,
            Attendance.status == "waitlisted",
        )
        .order_by(Attendance.joined_at.asc())
    )
    waitlisted = result.scalars().all()
    if not waitlisted:
        return

    mode = (session.waitlist_mode or "auto_promote").lower()
    if mode == "broadcast":
        users: list[User] = []
        for att in waitlisted:
            u = await db.get(User, att.user_id)
            if u:
                users.append(u)
        await notify_broadcast_spot_open(db, session, users)
        return

    # auto_promote: first waitlisted becomes confirmed
    first = waitlisted[0]
    first.status = "confirmed"
    rev = await bump_session_revision(db, session.id)
    await db.commit()
    if rev is not None:
        await notify_session_data_changed(session.id, rev)
    promoted = await db.get(User, first.user_id)
    if promoted:
        await notify_auto_promoted(db, session, promoted)


async def handle_leave_or_cancel(
    db: AsyncSession,
    session: GameSession,
    had_status: str,
) -> None:
    """had_status is the status before leave/cancel (confirmed or waitlisted)."""
    if had_status != "confirmed":
        return
    await handle_spot_opened(db, session)
