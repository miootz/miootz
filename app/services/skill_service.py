from collections import defaultdict
from datetime import datetime, timedelta, UTC

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.json_column import loads_int_list
from app.models.match import MatchSubstitution
from app.models.match_goal import MatchGoal
from app.models.rating import Rating
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.services.rankings_service import _aggregate, _load_scope
from app.services.rating_windows import meetup_end_time

_MAX_MISS_DECAY = 1.0
_WEIGHT_RECENT = 1.0
_WEIGHT_OLD = 0.5
_RECENT_ATTENDANCE_CUTOFF = 4
_MATCH_BONUS_HALF_LIFE = timedelta(weeks=3)
_MATCH_BONUS_PRIOR_WEIGHT = 3.0


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
        select(Rating.meetup_id, Rating.score).where(
            Rating.ratee_id == user_id, Rating.score.between(1, 5)
        )
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
    Recalculates the peer and attendance component of a user's skill.

    Peer ratings are recency-weighted: ratings from the user's 4 most recent
    confirmed attendances carry full weight; older ratings carry half weight.

    Miss decay: for consecutive locked meetups where the player has no
    confirmed attendance, subtract 0.1 per miss beyond the first,
    capped at 1.0.  One miss is forgiven; the penalty compounds from the second.

    With no peer ratings the stored value is left untouched.
    """
    user = await db.get(User, user_id)
    if not user:
        return

    avg_peer = await _get_weighted_peer_average(db, user_id)
    if avg_peer is None:
        return

    # Miss decay
    streak = await get_consecutive_miss_streak(db, user_id)
    decay = min(_MAX_MISS_DECAY, max(0, streak - 1) * 0.1)
    user.skill_without_match_bonus = avg_peer - decay
    _apply_match_bonus(user)
    if commit:
        await db.commit()
    else:
        await db.flush()


def _apply_match_bonus(user: User) -> None:
    base = user.skill_without_match_bonus
    if base is None:
        base = user.calculated_skill
    if base is not None:
        user.skill_without_match_bonus = base
        user.calculated_skill = round(
            max(0, min(5, base + (user.match_skill_bonus or 0))), 1
        )


async def refresh_match_skill_bonuses(db: AsyncSession) -> None:
    """Refresh match bonuses in the caller's transaction, including for absent players."""
    now = _utc_now()
    meetups = {
        meetup.id: meetup
        for meetup in (
            await db.scalars(
                select(Meetup).where(
                    Meetup.start_time <= now, Meetup.skipped.is_(False)
                )
            )
        ).all()
        if meetup_end_time(meetup) <= now
    }

    weights: dict[int, float] = defaultdict(float)
    bonuses: dict[int, float] = defaultdict(float)
    if meetups:
        as_of = max(meetup_end_time(meetup) for meetup in meetups.values())
        _, matches, goals, subs = await _load_scope(db, None, meetup_ids=list(meetups))
        goals_by_match: dict[int, list[MatchGoal]] = defaultdict(list)
        subs_by_match: dict[int, list[MatchSubstitution]] = defaultdict(list)
        for goal in goals:
            goals_by_match[goal.match_id].append(goal)
        for sub in subs:
            subs_by_match[sub.match_id].append(sub)

        for match in matches:
            match_goals = goals_by_match[match.id]
            match_subs = subs_by_match[match.id]
            stats = _aggregate({}, [match], match_goals, False, match_subs)
            played = set(loads_int_list(match.team_a_users))
            played.update(loads_int_list(match.team_b_users))
            for goal in match_goals:
                played.add(goal.scorer_id)
                if goal.assist_id is not None:
                    played.add(goal.assist_id)
                if goal.goalkeeper_id is not None:
                    played.add(goal.goalkeeper_id)
            for sub in match_subs:
                if sub.clock_secs is not None:
                    played.update(loads_int_list(sub.old_team_a_users))
                    played.update(loads_int_list(sub.old_team_b_users))

            age = as_of - _to_utc(meetups[match.meetup_id].start_time)
            weight = 0.5 ** (age / _MATCH_BONUS_HALF_LIFE)
            for user_id in played:
                weights[user_id] += weight
            for user_id, metrics in stats.items():
                match_bonus = (
                    0.30 * metrics["goals"]
                    + 0.20 * metrics["assists"]
                    + 0.10 * metrics["clean_sheets"]
                )
                bonuses[user_id] += min(0.60, match_bonus) * weight

    for user in await db.scalars(select(User)):
        bonus = bonuses[user.id] / (_MATCH_BONUS_PRIOR_WEIGHT + weights[user.id])
        if bonus or user.match_skill_bonus:
            user.match_skill_bonus = bonus
            _apply_match_bonus(user)


async def refresh_match_skills_after_meetup(db: AsyncSession, meetup_id: int) -> None:
    """Refresh after a historical correction or a match that finishes late."""
    meetup = await db.get(Meetup, meetup_id)
    if meetup and not meetup.skipped and meetup_end_time(meetup) <= _utc_now():
        await db.flush()
        await refresh_match_skill_bonuses(db)


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
