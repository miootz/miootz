from datetime import datetime, timedelta, UTC

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rating import Rating
from app.models.meetup import Attendance, Meetup
from app.models.user import User

_MAX_MISS_DECAY = 1.0
_WEIGHT_RECENT = 1.0
_WEIGHT_OLD = 0.5
_RECENT_ATTENDANCE_CUTOFF = 4


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


async def _get_locked_meetup_ids(db: AsyncSession, limit: int = 20) -> list[int]:
    """Return meetup IDs for past meetups with closed rating windows,
    ordered newest-first.

    A meetup's rating window closes when the next meetup starts (or 48 h after
    the meetup for the very latest one)."""
    now = _utc_now()

    result = await db.execute(
        select(Meetup.start_time)
        .where(Meetup.start_time <= now)
        .order_by(Meetup.start_time.desc())
    )
    all_starts = [row[0] for row in result.fetchall()]

    # Build a map: meetup_start -> lock_time (next meetup start, or start+48h)
    lock_map: dict[datetime, datetime] = {}
    for i, st in enumerate(all_starts):
        aware = _to_utc(st)
        if i + 1 < len(all_starts):
            lock_map[st] = _to_utc(all_starts[i + 1])
        else:
            lock_map[st] = aware + timedelta(hours=48)

    locked_starts = [st for st, lock in lock_map.items() if now >= lock][:limit]

    if not locked_starts:
        return []

    result = await db.execute(
        select(Meetup.id)
        .where(Meetup.start_time.in_(locked_starts))
        .order_by(Meetup.start_time.desc())
    )
    return [row[0] for row in result.fetchall()]


async def get_consecutive_miss_streak(db: AsyncSession, user_id: int) -> int:
    """Count of consecutive locked past meetups where the player has no
    confirmed attendance.  A miss is simply the absence of a confirmed
    attendance row -- rating activity is irrelevant."""
    locked_ids = await _get_locked_meetup_ids(db)
    if not locked_ids:
        return 0

    result = await db.execute(
        select(Attendance.meetup_id).where(
            Attendance.user_id == user_id,
            Attendance.status == "confirmed",
            Attendance.meetup_id.in_(locked_ids),
        )
    )
    confirmed_ids = {row[0] for row in result.fetchall()}

    streak = 0
    for sid in locked_ids:
        if sid in confirmed_ids:
            break
        streak += 1
    return streak


async def _get_weighted_peer_average(db: AsyncSession, user_id: int) -> float | None:
    """Compute the peer-rating average for a user with recency weighting.

    Ratings from the user's N most recent confirmed attendances carry full
    weight (1.0).  Ratings from older meetups carry reduced weight (0.5).
    Ratings from meetups the user never attended also carry reduced weight.
    Returns None if there are no ratings at all.
    """
    # Fetch the user's most recent confirmed meetup IDs
    result = await db.execute(
        select(Attendance.meetup_id)
        .where(
            Attendance.user_id == user_id,
            Attendance.status == "confirmed",
        )
        .order_by(Attendance.joined_at.desc())
        .limit(_RECENT_ATTENDANCE_CUTOFF)
    )
    recent_meetup_ids = {row[0] for row in result.fetchall()}

    # Fetch all ratings for this user
    result = await db.execute(
        select(Rating.meetup_id, Rating.score).where(Rating.ratee_id == user_id)
    )
    ratings = result.fetchall()
    if not ratings:
        return None

    weighted_sum = 0.0
    total_weight = 0.0
    for meetup_id, score in ratings:
        weight = _WEIGHT_RECENT if meetup_id in recent_meetup_ids else _WEIGHT_OLD
        weighted_sum += score * weight
        total_weight += weight

    if total_weight == 0:
        return None
    return weighted_sum / total_weight


async def update_user_calculated_skill(
    db: AsyncSession, user_id: int, *, commit: bool = True
) -> None:
    """
    Recalculates the 'calculated_skill' for a user based on:
    (self_assessed_skill * 0.4 + weighted_avg_peer_rating * 0.6) - miss_decay

    Peer ratings are recency-weighted: ratings from the user's 4 most recent
    confirmed attendances carry full weight; older ratings carry half weight.

    Miss decay: for consecutive locked meetups where the player has no
    confirmed attendance, subtract 0.1 per miss beyond the first,
    capped at 1.0.  One miss is forgiven; the penalty compounds from the second.
    """
    user = await db.get(User, user_id)
    if not user:
        return

    avg_peer = await _get_weighted_peer_average(db, user_id)

    if avg_peer is None:
        if user.self_assessed_skill is not None:
            user.calculated_skill = user.self_assessed_skill
            if commit:
                await db.commit()
            else:
                await db.flush()
        return

    W_SELF = 0.4
    W_PEER = 0.6
    self_val = user.self_assessed_skill if user.self_assessed_skill is not None else 0
    try:
        peer_val = float(avg_peer)
    except TypeError, ValueError:
        peer_val = 0.0
    base_skill = (self_val * W_SELF) + (peer_val * W_PEER)

    # Miss decay
    streak = await get_consecutive_miss_streak(db, user_id)
    decay = min(_MAX_MISS_DECAY, max(0, streak - 1) * 0.1)
    new_skill = base_skill - decay
    user.calculated_skill = round(max(0, new_skill), 1)
    if commit:
        await db.commit()
    else:
        await db.flush()


async def recalculate_skills_for_attendance_change(
    db: AsyncSession, meetup_id: int, changed_user_id: int
) -> None:
    """Recalculate calculated_skill for players affected by an attendance change.

    When a user joins or leaves a meetup, their own attendance history shifts,
    which changes the recency weighting of their peer ratings.  Only the changed
    user needs recalculation (other attendees' histories are unaffected).
    """
    # Check the changed user still has an attendance row (even cancelled ones
    # affect the "most recent confirmed" ranking when they rejoin later)
    result = await db.execute(
        select(Attendance).where(
            Attendance.meetup_id == meetup_id,
            Attendance.user_id == changed_user_id,
        )
    )
    if result.scalar_one_or_none() is not None:
        await update_user_calculated_skill(db, user_id=changed_user_id)
