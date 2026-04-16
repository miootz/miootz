"""Shared logic for magic-link and in-app session attendance changes."""

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import Attendance, GameSession
from app.models.user import User


async def count_confirmed(db: AsyncSession, session_id: int) -> int:
    r = await db.execute(
        select(func.count(Attendance.id)).where(
            Attendance.session_id == session_id,
            Attendance.status == "confirmed",
        )
    )
    return int(r.scalar() or 0)


async def get_attendance(
    db: AsyncSession, session_id: int, user_id: int
) -> Attendance | None:
    r = await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.user_id == user_id,
        )
    )
    return r.scalar_one_or_none()


async def process_magic_confirm(db: AsyncSession, session_id: int, user_id: int) -> str:
    session = await db.get(GameSession, session_id)
    if not session:
        return "Session not found"

    user = await db.get(User, user_id)
    if not user:
        return "User not found"

    att = await get_attendance(db, session_id, user_id)
    if not att:
        return "You are not registered for this session"

    now = datetime.now(timezone.utc)
    st = session.start_time
    if st.tzinfo is None:
        st = st.replace(tzinfo=timezone.utc)
    if now >= st:
        return "Session has already started"

    confirmed_n = await count_confirmed(db, session_id)

    if att.status == "confirmed":
        await db.commit()
        return "You are already confirmed"

    if att.status == "cancelled":
        att.previous_status = None
        if confirmed_n < session.max_players:
            att.status = "confirmed"
        else:
            att.status = "waitlisted"
            att.joined_at = datetime.now(timezone.utc)
        await db.commit()
        return "Welcome back — your status has been updated"

    if att.status == "waitlisted":
        if confirmed_n < session.max_players:
            att.status = "confirmed"
            await db.commit()
            return "You are confirmed for this session"
        await db.commit()
        return "Still on the waitlist — no open spots yet"

    await db.commit()
    return "Updated"


async def process_magic_cancel(db: AsyncSession, session_id: int, user_id: int) -> str:
    session = await db.get(GameSession, session_id)
    if not session:
        return "Session not found"

    att = await get_attendance(db, session_id, user_id)
    if not att:
        return "You are not registered for this session"

    if att.status == "cancelled":
        return "Already cancelled"

    if att.status in ("confirmed", "waitlisted"):
        att.previous_status = att.status
        att.status = "cancelled"
        await db.commit()

        from app.services.session_promotion import handle_spot_opened

        await handle_spot_opened(db, session)
        return "You are cancelled. Use Reactivate if this was a mistake."

    await db.commit()
    return "Updated"


async def process_magic_reactivate(db: AsyncSession, session_id: int, user_id: int) -> str:
    session = await db.get(GameSession, session_id)
    if not session:
        return "Session not found"

    att = await get_attendance(db, session_id, user_id)
    if not att or att.status != "cancelled":
        return "Nothing to reactivate"

    prev = att.previous_status or "waitlisted"
    confirmed_n = await count_confirmed(db, session_id)

    if prev == "confirmed":
        if confirmed_n < session.max_players:
            att.status = "confirmed"
            att.previous_status = None
            msg = "You are confirmed again"
        else:
            att.status = "waitlisted"
            att.joined_at = datetime.now(timezone.utc)
            att.previous_status = None
            msg = "No room — you have been placed on the waitlist"
    else:
        att.status = "waitlisted"
        att.joined_at = datetime.now(timezone.utc)
        att.previous_status = None
        msg = "You are back on the waitlist"

    await db.commit()
    return msg
