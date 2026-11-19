from datetime import datetime, timedelta, UTC
from collections import defaultdict

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rating import PEER_REVIEW_ADJUSTMENTS, Rating
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.services.player_attributes import (
    effective_player_attributes,
    load_player_attributes,
    pace_and_dribbling,
)
from app.services.peer_rating_policy import teammate_pairs
from app.services.rating_settings import PeerRatingMode, get_rating_settings
from app.services.rating_windows import meetup_end_time

_MAX_MISS_DECAY = 1.0
_PEER_HALF_LIFE_MEETUPS = 2
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


async def _peer_meetup_positions(db: AsyncSession) -> dict[int, int]:
    now = _utc_now()
    meetups = await db.scalars(
        select(Meetup)
        .where(Meetup.skipped.is_(False), Meetup.start_time <= now)
        .order_by(Meetup.start_time.desc(), Meetup.id.desc())
    )
    return {
        meetup.id: index
        for index, meetup in enumerate(m for m in meetups if meetup_end_time(m) <= now)
    }


async def _get_weighted_peer_average(
    db: AsyncSession,
    user_id: int,
    pairs: dict[int, set[tuple[int, int]]] | None,
    positions: dict[int, int],
    anchor: float = 3.0,
) -> tuple[float | None, float | None]:
    """Return a legacy star average or a relative adjustment across meetups."""
    if not positions:
        return None, None

    votes = await db.scalars(
        select(Rating)
        .where(
            Rating.ratee_id == user_id,
            Rating.rater_id != user_id,
            Rating.score.between(1, 5),
        )
    )
    by_meetup: dict[int, dict[int, Rating]] = defaultdict(dict)
    for vote in votes:
        if vote.meetup_id not in positions:
            continue
        pair = (min(vote.rater_id, user_id), max(vote.rater_id, user_id))
        if pairs is not None and pair not in pairs.get(vote.meetup_id, ()):
            continue
        by_meetup[vote.meetup_id][vote.rater_id] = vote
    qualified = {mid: scores for mid, scores in by_meetup.items() if len(scores) >= 3}
    if not qualified:
        return None, None

    latest_position = min(positions[mid] for mid in qualified)
    weighted_sum = 0.0
    total_weight = 0.0
    has_reviews = False
    for meetup_id, ratings in qualified.items():
        distance = positions[meetup_id] - latest_position
        weight = 0.5 ** (distance / _PEER_HALF_LIFE_MEETUPS)
        scores = []
        for vote in ratings.values():
            if vote.review is None:
                scores.append(vote.score)
            else:
                has_reviews = True
                scores.append(anchor + PEER_REVIEW_ADJUSTMENTS[vote.review])
        weighted_sum += (sum(scores) / len(scores)) * weight
        total_weight += weight

    average = weighted_sum / total_weight
    return (None, average - anchor) if has_reviews else (average, None)


def blend_skill(
    seed: float | None,
    peer: float | None,
    attributes: dict[str, float | None],
    miss_streak: int = 0,
    *,
    peer_adjustment: float | None = None,
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
    if peer_adjustment is not None:
        skill += 0.25 * peer_adjustment
    if peer is not None or peer_adjustment is not None:
        skill -= min(_MAX_MISS_DECAY, max(0, miss_streak - 1) * 0.1)
    return round(max(0, min(5, skill)), 1)


async def _update_skill(
    db: AsyncSession,
    user: User,
    attributes: dict,
    pairs: dict[int, set[tuple[int, int]]] | None,
    positions: dict[int, int],
    locked_ids: list[int] | None = None,
) -> None:
    anchor = user.seed_skill if user.seed_skill is not None else 3.0
    peer, adjustment = await _get_weighted_peer_average(db, user.id, pairs, positions, anchor)
    streak = (
        await get_consecutive_miss_streak(db, user.id, locked_ids=locked_ids)
        if peer is not None or adjustment is not None
        else 0
    )
    scores = {
        key: evidence["score"]
        for key, evidence in effective_player_attributes(user, attributes).items()
    }
    scores.update(pace_and_dribbling(user))
    user.calculated_skill = blend_skill(
        anchor if adjustment is not None else user.seed_skill,
        peer, scores, streak, peer_adjustment=adjustment,
    )


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
        positions = {} if settings.peer_rating_mode == "off" else await _peer_meetup_positions(db)
        await _update_skill(db, user, attributes, pairs, positions)
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
    positions = {} if settings.peer_rating_mode == "off" else await _peer_meetup_positions(db)
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
            pairs,
            positions,
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
    """Refresh the changed player's rating to reflect their attendance streak."""
    result = await db.execute(
        select(Attendance).where(
            Attendance.meetup_id == meetup_id,
            Attendance.user_id == changed_user_id,
        )
    )
    if result.scalar_one_or_none() is not None:
        await update_user_calculated_skill(db, user_id=changed_user_id)
