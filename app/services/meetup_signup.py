"""Short signup holds ahead of Pocket ID authentication."""

import hmac
import os
from datetime import UTC, datetime, timedelta
from functools import lru_cache

from py_vapid import Vapid, VapidException
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import async_session
from app.core.timeutil import to_utc, utcnow
from app.models.meetup import Attendance, Meetup
from app.models.meetup_signup_hold import MeetupSignupHold

HOLD_DURATION = timedelta(minutes=2)


def signup_hold_token(meetup: Meetup, user_id: int) -> str:
    expiry = int(to_utc(meetup.start_time).timestamp())
    payload = f"{meetup.id}.{user_id}.{expiry}"
    return f"{payload}.{_sign(payload)}"


@lru_cache(maxsize=2)
def _hold_signing_key(configured_key: str) -> bytes:
    vapid = Vapid.from_file(configured_key) if os.path.isfile(configured_key) else Vapid.from_string(configured_key)
    private_scalar = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    return hmac.digest(private_scalar, b"miootz:meetup-signup-hold:v1", "sha256")


def _sign(payload: str) -> str:
    return hmac.digest(_hold_signing_key(settings.VAPID_PRIVATE_KEY), payload.encode(), "sha256").hex()


def read_signup_hold_token(token: str, now: datetime) -> tuple[int, int] | None:
    if not settings.VAPID_PRIVATE_KEY:
        return None
    try:
        meetup, user, expiry, signature = token.split(".")
        if not hmac.compare_digest(signature, _sign(f"{meetup}.{user}.{expiry}")):
            return None
        if int(expiry) <= to_utc(now).timestamp():
            return None
        return int(meetup), int(user)
    except (ValueError, TypeError, OSError, VapidException):
        return None


async def open_signup_hold(
    db: AsyncSession, meetup: Meetup, user_id: int, now: datetime
) -> MeetupSignupHold:
    """Must run under a write lock. The first tap fixes the expiry forever."""
    hold = await find_signup_hold(db, meetup.id, user_id)
    if hold is not None:
        return hold
    hold = MeetupSignupHold(
        meetup_id=meetup.id, user_id=user_id, started_at=now,
        expires_at=min(now + HOLD_DURATION, to_utc(meetup.start_time).replace(tzinfo=None)),
    )
    db.add(hold)
    await db.flush()
    from app.services.job_queue import upsert_job

    await upsert_job(db, "signup_hold_expiry", hold.id, hold.expires_at)
    return hold


async def find_signup_hold(db: AsyncSession, meetup_id: int, user_id: int) -> MeetupSignupHold | None:
    return await db.scalar(select(MeetupSignupHold).where(
        MeetupSignupHold.meetup_id == meetup_id, MeetupSignupHold.user_id == user_id,
    ))


async def active_hold_times(db: AsyncSession, meetup_id: int, now: datetime) -> list[datetime]:
    return list(await db.scalars(select(MeetupSignupHold.started_at).where(
        MeetupSignupHold.meetup_id == meetup_id,
        MeetupSignupHold.settled.is_(False), MeetupSignupHold.expires_at > now,
    )))


async def signup_status(
    db: AsyncSession, meetup: Meetup, joined_at: datetime, now: datetime,
    *, respect_waitlist: bool = True,
) -> str:
    """Count confirmed spots and earlier entries in the signup queue."""
    occupied = [Attendance.status == "confirmed"]
    if respect_waitlist and meetup.waitlist_mode != "broadcast":
        occupied.append((Attendance.status == "waitlisted") & (Attendance.joined_at <= joined_at))
    count = await db.scalar(select(func.count()).select_from(Attendance).where(
        Attendance.meetup_id == meetup.id, or_(*occupied),
    ))
    holds = await active_hold_times(db, meetup.id, now)
    return "confirmed" if count + sum(at < joined_at for at in holds) < meetup.max_players else "waitlisted"


async def expire_signup_hold(hold_id: int) -> None:
    from app.services.meetup_promotion import handle_spot_opened

    async with async_session() as db:
        await db.execute(text("BEGIN IMMEDIATE"))
        hold = await db.get(MeetupSignupHold, hold_id)
        now = utcnow()
        if hold is None or hold.settled or hold.expires_at > now:
            return
        hold.settled = True
        meetup = await db.get(Meetup, hold.meetup_id)
        if meetup is None or meetup.skipped or to_utc(meetup.start_time) <= now.replace(tzinfo=UTC):
            await db.commit()
            return
        await db.flush()
        await handle_spot_opened(db, meetup, queue_changed=True)
