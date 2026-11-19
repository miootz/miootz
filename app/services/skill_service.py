from datetime import datetime, timedelta, UTC
from collections import defaultdict

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rating import Rating
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.services.player_attributes import load_player_attributes
from app.services.peer_rating_policy import teammate_pairs
from app.services.rating_settings import PeerRatingMode, get_rating_settings
from app.services.rating_windows import meetup_end_time

_MAX_MISS_DECAY = 1.0
_WEIGHT_RECENT = 1.0
_WEIGHT_OLD = 0.5
_RECENT_ATTENDANCE_CUTOFF = 4
_ATTRIBUTE_WEIGHTS = {"sho": 0.06, "pas": 0.05, "def": 0.05, "pac": 0.02, "dri": 0.02}


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


async def get_consecutive_miss_streak(
    db: AsyncSession, user_id: int, *, locked_ids: list[int] | None = None
) -> int:
    """Count of consecutive locked past meetups where the player has no
    confirmed attendance.  A miss is simply the absence of a confirmed
    attendance row -- rating activity is irrelevant."""
    if locked_ids is None:
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


async def _get_weighted_peer_average(
    db: AsyncSession,
    user_id: int,
    mode: PeerRatingMode,
    pairs: dict[int, set[tuple[int, int]]] | None,
) -> float | None:
    """Compute the peer-rating average for a user with recency weighting.

    Ratings from the user's N most recent confirmed attendances carry full
    weight (1.0).  Ratings from older meetups carry reduced weight (0.5).
    Ratings from meetups the user never attended also carry reduced weight.
    Each meetup needs three eligible reviewers before its votes count.
    """
    if mode == "off":
        return None

    votes = await db.scalars(
        select(Rating)
        .join(Meetup)
        .where(
            Rating.ratee_id == user_id,
            Rating.rater_id != user_id,
            Rating.score.between(1, 5),
            Meetup.skipped.is_(False),
        )
    )
    by_meetup: dict[int, dict[int, int]] = defaultdict(dict)
    for vote in votes:
        pair = (min(vote.rater_id, user_id), max(vote.rater_id, user_id))
        if pairs is not None and pair not in pairs.get(vote.meetup_id, ()):
            continue
        by_meetup[vote.meetup_id][vote.rater_id] = vote.score
    qualified = {mid: scores for mid, scores in by_meetup.items() if len(scores) >= 3}
    if not qualified:
        return None

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

    weighted_sum = 0.0
    total_weight = 0.0
    for meetup_id, scores in qualified.items():
        weight = _WEIGHT_RECENT if meetup_id in recent_meetup_ids else _WEIGHT_OLD
        weighted_sum += sum(scores.values()) * weight
        total_weight += len(scores) * weight

    return weighted_sum / total_weight


def blend_skill(
    seed: float | None,
    peer: float | None,
    attributes: dict[str, float | None],
    miss_streak: int = 0,
) -> float | None:
    """Blend the ratings that exist, with missing attribute weight left on the baseline."""
    baseline = seed if peer is None else peer
    if baseline is None:
        return None
    if seed is not None and peer is not None:
        baseline = (55 * seed + 25 * peer) / 80

    skill = baseline
    for key, weight in _ATTRIBUTE_WEIGHTS.items():
        score = attributes.get(key)
        if score is not None:
            skill += weight * (score - baseline)
    if peer is not None:
        skill -= min(_MAX_MISS_DECAY, max(0, miss_streak - 1) * 0.1)
    return round(max(0, min(5, skill)), 1)


async def _update_skill(
    db: AsyncSession,
    user: User,
    attributes: dict,
    mode: PeerRatingMode,
    pairs: dict[int, set[tuple[int, int]]] | None,
    locked_ids: list[int] | None = None,
) -> None:
    peer = await _get_weighted_peer_average(db, user.id, mode, pairs)
    streak = (
        await get_consecutive_miss_streak(db, user.id, locked_ids=locked_ids)
        if peer is not None
        else 0
    )
    scores = {key: evidence["score"] for key, evidence in attributes.items()}
    scores.update(pac=user.pac, dri=user.dri)
    user.calculated_skill = blend_skill(user.seed_skill, peer, scores, streak)


async def _load_peer_pairs(
    db: AsyncSession, mode: PeerRatingMode, user_id: int | None = None
):
    if mode != "teammates-only":
        return None
    query = select(Rating.meetup_id).where(Rating.score.between(1, 5)).distinct()
    if user_id is not None:
        query = query.where(Rating.ratee_id == user_id)
    return await teammate_pairs(db, (await db.scalars(query)).all())


async def update_user_calculated_skill(
    db: AsyncSession, user_id: int, *, commit: bool = True
) -> None:
    user = await db.get(User, user_id)
    if user is None:
        return
    settings = await get_rating_settings(db)
    if settings.computed_scores:
        attributes = (await load_player_attributes(db)).get(user_id, {})
        pairs = await _load_peer_pairs(db, settings.peer_rating_mode, user_id)
        await _update_skill(db, user, attributes, settings.peer_rating_mode, pairs)
    if commit:
        await db.commit()
    else:
        await db.flush()


async def refresh_player_skills(db: AsyncSession) -> None:
    """Refresh overall skills in the caller's transaction after a change in match data."""
    settings = await get_rating_settings(db)
    if not settings.computed_scores:
        return
    attributes = await load_player_attributes(db)
    pairs = await _load_peer_pairs(db, settings.peer_rating_mode)
    locked_ids = await _get_locked_meetup_ids(db)
    users = await db.scalars(
        select(User).where(
            or_(
                User.seed_skill.is_not(None),
                User.calculated_skill.is_not(None),
                User.id.in_(select(Rating.ratee_id).where(Rating.score.between(1, 5))),
            )
        )
    )
    for user in users:
        await _update_skill(
            db,
            user,
            attributes.get(user.id, {}),
            settings.peer_rating_mode,
            pairs,
            locked_ids,
        )


async def refresh_skills_after_meetup(db: AsyncSession, meetup_id: int) -> None:
    """Refresh after a historical correction or a match that finishes late."""
    meetup = await db.get(Meetup, meetup_id)
    if meetup and not meetup.skipped and meetup_end_time(meetup) <= _utc_now():
        await db.flush()
        await refresh_player_skills(db)


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
