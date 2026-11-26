"""Live match management: start matches, timer, scores, end matches."""

from __future__ import annotations

import json
import logging
import secrets
from collections.abc import Sequence
from datetime import datetime, timedelta, UTC

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, insert, or_, select, text, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Literal, cast

from app.api.deps import (
    presence_for_meetup,
    require_admin,
    require_admin_or_present_member,
)
from app.core.database import get_db
from app.core.json_column import loads_int_list as _loads_int_list
from app.core.meetup_data_manager import meetup_data_manager
from app.core.timeutil import utcnow
from app.models.match import MeetupMatch, MatchPenalty, MatchSubstitution
from app.models.match_editor_lease import MatchEditorLease
from app.models.match_goal import MatchGoal
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.services.manual_teams import (
    apply_roster_swap,
    ensure_team_names,
    get_team_names,
    resolve_meetup_teams_nested,
)
from app.services.team_names import team_name as _team_name
from app.services.meetup_revision import (
    bump_and_notify,
    bump_meetup_revision,
    notify_meetup_data_changed,
)
from app.services.audit import log_action
from app.services.skill_service import refresh_skills_after_meetup
from app.services.team_assignment import draft_skill
from app.services.team_adjustment import fill_empty_pending_matches
from app.services.rating_settings import get_rating_settings, selected_rating

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meetups", tags=["matches"])


# ── Pydantic schemas ──────────────────────────────────────────────


class MatchTeamSwap(BaseModel):
    team_a_users: list[int] = Field(min_length=1)
    team_b_users: list[int] = Field(min_length=1)
    add_sideline_player: bool = False


class HistoricalLineupChange(BaseModel):
    team: str = Field(pattern=r"^[ab]$")
    player_off: int | None = None
    player_on: int | None = None
    elapsed_seconds: int | None = Field(default=None, gt=0)
    swap_teams: bool = False


class MatchEndBody(BaseModel):
    #: Required only when scores are tied. "a" or "b".
    winner_team: str | None = None
    #: When set, do not auto-queue the next match — the referee is choosing
    #: to override the team picking (e.g. when ending a match by hand).
    skip_next_match: bool = False


class PenaltyShotBody(BaseModel):
    team: str = Field(pattern=r"^[ab]$")
    scored: bool
    #: The taker — chosen per shot, order is decided on the pitch.
    scorer_id: int


class TimerAdjustment(BaseModel):
    delta_seconds: Literal[-15, 15]


class MatchScoreDelta(BaseModel):
    team: str = Field(pattern=r"^[ab]$")
    delta: int = Field(default=1, ge=-99, le=99)


class CreatePendingMatchBody(BaseModel):
    team_a_idx: int | None = None
    team_b_idx: int | None = None


class StartMatchesBody(BaseModel):
    team_a_idx: int | None = None
    team_b_idx: int | None = None


class MatchCreateBody(BaseModel):
    team_a_name: str = Field(min_length=1, max_length=60)
    team_b_name: str = Field(min_length=1, max_length=60)
    score_a: int = Field(ge=0)
    score_b: int = Field(ge=0)
    team_a_users: list[int] = Field(default_factory=list)
    team_b_users: list[int] = Field(default_factory=list)


class MatchScoreSet(BaseModel):
    score_a: int = Field(ge=0)
    score_b: int = Field(ge=0)


class LeaseTokenBody(BaseModel):
    #: Token handed out by ``lease/acquire``; must be echoed to renew/release.
    lease_token: str = Field(min_length=1)


class GoalCreate(BaseModel):
    team: str = Field(pattern=r"^[ab]$")
    scorer_id: int | None = None
    assist_id: int | None = None
    #: Keeper who was in goal for the *conceding* team (must be an opposing
    #: player). Optional — nobody should be blocked on an unknown/rotated keeper.
    goalkeeper_id: int | None = None
    clock_minute: int | None = Field(default=None, ge=1, le=600)
    #: Own goal: the scorer is on the conceding team (still counts toward
    #: ``team``'s score).
    is_own_goal: bool = False
    #: Client-minted idempotency key (UUID hex) — a retry replays the goal.
    intent_id: str = Field(min_length=1, max_length=64)
    #: Explicit user confirmation that a duplicated/after-whistle entry stands.
    force: bool = False


class GoalUpdate(BaseModel):
    """Full re-attribution of a logged goal (edit sheet)."""

    team: str = Field(pattern=r"^[ab]$")
    scorer_id: int | None = None
    assist_id: int | None = None
    goalkeeper_id: int | None = None
    clock_minute: int = Field(ge=1, le=600)
    is_own_goal: bool = False


class HistoricalGoalAttribution(BaseModel):
    goal_id: int | None = None
    intent_id: str = Field(min_length=1, max_length=64)
    team: str = Field(pattern=r"^[ab]$")
    scorer_id: int | None = None
    assist_id: int | None = None
    goalkeeper_id: int | None = None
    is_own_goal: bool = False
    add_to_score: bool = False


# ── Helpers ───────────────────────────────────────────────────────


def _compute_timer_remaining(match: MeetupMatch, *, at: datetime | None = None) -> int:
    """Compute server-authoritative remaining seconds."""
    if match.timer_started_at is None:
        return match.timer_total_seconds
    if match.status == "completed" and at is None:
        return 0
    if at is None and _is_currently_paused(match) and match.timer_seconds_remaining is not None:
        return match.timer_seconds_remaining

    started = match.timer_started_at.replace(tzinfo=UTC)
    now = at.replace(tzinfo=UTC) if at is not None else datetime.now(UTC)
    elapsed = (now - started).total_seconds()

    # Subtract pause intervals
    pause_intervals: list[dict] = []
    if match.timer_pause_intervals:
        try:
            pause_intervals = json.loads(match.timer_pause_intervals)
        except json.JSONDecodeError, TypeError:
            pass

    adjustment = 0
    for interval in pause_intervals:
        paused_at = interval.get("paused_at")
        resumed_at = interval.get("resumed_at")
        if paused_at:
            pa = datetime.fromisoformat(paused_at).replace(tzinfo=UTC)
            if pa <= now:
                adjustment += interval.get("adjustment_seconds", 0)
            if resumed_at:
                ra = datetime.fromisoformat(resumed_at).replace(tzinfo=UTC)
                elapsed -= (ra - pa).total_seconds()
            else:
                # Currently paused — pause until now
                elapsed -= (now - pa).total_seconds()

    try:
        remaining = int(match.timer_total_seconds or 0) + adjustment - int(elapsed)
    except TypeError, ValueError, OverflowError:
        return 0
    return max(remaining, 0)


def _timer_ends_at_iso(match: MeetupMatch) -> str | None:
    """Server-authoritative end time (UTC ISO) while the timer runs; None when
    not started, finished, or currently paused. Lets clients render the
    remaining time from a shared timestamp instead of free-running counters."""
    if match.status != "active" or match.timer_started_at is None:
        return None
    if _is_currently_paused(match):
        return None
    try:
        intervals: list[dict] = (
            json.loads(match.timer_pause_intervals)
            if match.timer_pause_intervals
            else []
        )
    except json.JSONDecodeError, TypeError:
        intervals = []
    ends = match.timer_started_at.replace(tzinfo=UTC) + timedelta(
        seconds=match.timer_total_seconds
    )
    for interval in intervals:
        paused_at = interval.get("paused_at")
        resumed_at = interval.get("resumed_at")
        if paused_at and resumed_at:
            ends += timedelta(seconds=interval.get("adjustment_seconds", 0))
            pa = datetime.fromisoformat(paused_at).replace(tzinfo=UTC)
            ra = datetime.fromisoformat(resumed_at).replace(tzinfo=UTC)
            # A pause pushes the end time LATER by its duration.
            ends += ra - pa
    return ends.isoformat()


async def _check_timer_expiry(match: MeetupMatch, db: AsyncSession) -> bool:
    """If timer has expired, auto-transition to 'time_up' and broadcast.
    Returns True if the match was transitioned.

    IMPORTANT: persists the transition with an explicit commit — the shared
    ``get_db`` dependency never commits, so a bare flush would roll back and
    the match would reappear as 'active' (timer reset) on the next poll."""
    if match.status != "active" or _is_currently_paused(match):
        return False
    remaining = _compute_timer_remaining(match)
    if remaining <= 0:
        match.status = "time_up"
        match.timer_seconds_remaining = 0
        await bump_and_notify(db, match.meetup_id)
        await _broadcast_match_event(
            match.meetup_id,
            {
                "type": "match_timer_expired",
                "match_id": match.id,
                "seconds_remaining": 0,
                "status": "time_up",
            },
        )
        return True
    return False


def _match_json(match: MeetupMatch, users_by_id: dict[int, dict]) -> dict:
    """Serialize a MeetupMatch with user details."""
    team_a_users: list[int] = _loads_int_list(match.team_a_users)
    team_b_users: list[int] = _loads_int_list(match.team_b_users)

    def _user_list(ids: list[int]) -> list[dict]:
        result = []
        for uid in ids:
            u = users_by_id.get(uid)
            if u:
                result.append(u)
            else:
                result.append(
                    {"id": uid, "display_name": f"User {uid}", "avatar_url": None}
                )
        return result

    out = {
        "id": match.id,
        "meetup_id": match.meetup_id,
        "match_number": match.match_number,
        "team_a": {
            "name": match.team_a_name,
            "users": _user_list(team_a_users),
        },
        "team_b": {
            "name": match.team_b_name,
            "users": _user_list(team_b_users),
        },
        "score_a": match.score_a,
        "score_b": match.score_b,
        "was_draw": match.was_draw,
        "penalty_winner": match.penalty_winner,
        "penalty_skipped": match.penalty_skipped,
        "penalty_score_a": match.penalty_score_a,
        "penalty_score_b": match.penalty_score_b,
        "status": match.status,
        "timer_total_seconds": match.timer_total_seconds,
        "timer_seconds_remaining": _compute_timer_remaining(match),
        "timer_paused": match.timer_pause_intervals is not None
        and _is_currently_paused(match),
        "timer_ends_at": _timer_ends_at_iso(match),
        "created_at": match.created_at.isoformat() if match.created_at else None,
        "completed_at": match.completed_at.isoformat() if match.completed_at else None,
    }
    return out


def _is_currently_paused(match: MeetupMatch) -> bool:
    """Check if the last pause interval has no resumed_at (currently paused)."""
    if not match.timer_pause_intervals:
        return False
    try:
        intervals = json.loads(match.timer_pause_intervals)
        if intervals:
            return intervals[-1].get("resumed_at") is None
    except json.JSONDecodeError, TypeError:
        pass
    return False


async def _load_users_for_meetup(db: AsyncSession, meetup_id: int) -> dict[int, dict]:
    """Load all users who have any attendance for this meetup."""
    from app.models.meetup import Attendance

    result = await db.execute(
        select(User, Attendance)
        .join(Attendance, Attendance.user_id == User.id)
        .where(Attendance.meetup_id == meetup_id)
    )
    users: dict[int, dict] = {}
    for user, _ in result:
        users[user.id] = {
            "id": user.id,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
            "pac": user.pac,
            "dri": user.dri,
        }
    return users


async def _broadcast_match_event(meetup_id: int, event: dict) -> None:
    """Broadcast a match event via the meetup data SSE channel."""
    await meetup_data_manager.broadcast(meetup_id, event)


# ── Endpoints ─────────────────────────────────────────────────────


@router.get("/{meetup_id}/matches")
async def list_meetup_matches(
    meetup_id: int,
    db: AsyncSession = Depends(get_db),
):
    """List all matches for a meetup (public)."""
    meetup = await db.get(Meetup, meetup_id)
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    result = await db.execute(
        select(MeetupMatch)
        .where(MeetupMatch.meetup_id == meetup_id)
        .order_by(MeetupMatch.match_number.asc())
    )
    matches = result.scalars().all()

    # Sweep expired timers so polling clients (no SSE) never see a frozen clock.
    for m in matches:
        await _check_timer_expiry(m, db)

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return {
        "matches": [_match_json(m, users_by_id) for m in matches],
        "match_duration_minutes": meetup.match_duration_minutes or 10,
    }


@router.get("/{meetup_id}/matches/{match_id}")
async def get_match(
    meetup_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get a single match with timer state (public)."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")

    # Auto-transition expired timer
    await _check_timer_expiry(match, db)

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return _match_json(match, users_by_id)


@router.post("/{meetup_id}/matches/start", status_code=201)
async def start_matches(
    meetup_id: int,
    request: Request,
    body: StartMatchesBody | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_present_member),
):
    """Start the match meetup. Creates the first match (Team A vs Team B by default,
    or the given team indices when provided)."""
    meetup = await db.get(Meetup, meetup_id)
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    # Check if matches already exist
    existing = await db.execute(
        select(MeetupMatch)
        .where(MeetupMatch.meetup_id == meetup_id)
        .order_by(MeetupMatch.match_number.asc())
        .limit(1)
    )
    first = existing.scalar_one_or_none()
    if first:
        # Return existing first match (idempotent)
        users_by_id = await _load_users_for_meetup(db, meetup_id)
        return {"status": "already_started", "match": _match_json(first, users_by_id)}

    # Load confirmed players
    result = await db.execute(
        select(User)
        .join(Attendance, Attendance.user_id == User.id)
        .where(
            Attendance.meetup_id == meetup_id,
            Attendance.status == "confirmed",
        )
    )
    confirmed_users = result.scalars().all()
    computed_scores = (await get_rating_settings(db)).computed_scores
    players = [
        {
            "id": str(u.id),
            "name": u.display_name,
            "skill": draft_skill(selected_rating(u, computed_scores)),
            "user_id": u.id,
            "avatar_url": u.avatar_url,
            "primary_specialty": u.primary_specialty,
            "secondary_specialty": u.secondary_specialty,
            "calculated_skill": selected_rating(u, computed_scores),
            "pac": u.pac,
            "dri": u.dri,
        }
        for u in confirmed_users
    ]

    # Resolve teams
    mode = getattr(meetup, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_meetup_teams_nested(
        getattr(meetup, "manual_teams_json", None),
        mode,
        players,
        max_teams=getattr(meetup, "max_teams", None),
        team_size=meetup.team_size,
    )
    nonempty_team_count = sum(bool(team) for team in teams_nested)
    if nonempty_team_count < 2:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least 2 teams to start matches. Found {nonempty_team_count}.",
        )

    if mode == "auto-balanced":
        meetup.manual_teams_json = json.dumps(
            [[int(p["id"]) for p in team] for team in teams_nested]
        )

    # Ensure team names exist
    team_names = ensure_team_names(meetup, len(teams_nested))
    await db.flush()

    team_a_idx = body.team_a_idx if body and body.team_a_idx is not None else 0
    team_b_idx = body.team_b_idx if body and body.team_b_idx is not None else 1
    if (
        not 0 <= team_a_idx < len(teams_nested)
        or not 0 <= team_b_idx < len(teams_nested)
        or team_a_idx == team_b_idx
    ):
        raise HTTPException(
            status_code=400,
            detail="team_a_idx/team_b_idx must be distinct valid team indices.",
        )
    if meetup.max_teams and meetup.team_size and (team_a_idx >= meetup.max_teams or team_b_idx >= meetup.max_teams):
        raise HTTPException(status_code=400, detail="Bench cannot play as a team.")
    if not teams_nested[team_a_idx] or not teams_nested[team_b_idx]:
        raise HTTPException(status_code=400, detail="Both teams must have players.")

    team_a = teams_nested[team_a_idx]
    team_b = teams_nested[team_b_idx]

    match_duration = meetup.match_duration_minutes or 10

    match = MeetupMatch(
        meetup_id=meetup_id,
        match_number=1,
        team_a_users=json.dumps([p["user_id"] for p in team_a]),
        team_b_users=json.dumps([p["user_id"] for p in team_b]),
        team_a_name=team_names[team_a_idx] if team_names else _team_name(1),
        team_b_name=(
            team_names[team_b_idx]
            if team_names and len(team_names) > team_b_idx
            else _team_name(2)
        ),
        score_a=0,
        score_b=0,
        status="pending",
        timer_total_seconds=match_duration * 60,
        timer_seconds_remaining=None,
    )
    db.add(match)
    pitch_matches = [match]

    # Round 1 on the remaining teams — the second pitch match (and any
    # further pair) when more teams are available. Each pair is one pitch.
    remaining = [
        i for i in range(len(teams_nested)) if i != team_a_idx and i != team_b_idx
    ]
    for i in range(0, len(remaining) - 1, 2):
        a_idx, b_idx = remaining[i], remaining[i + 1]
        team_a_p = teams_nested[a_idx]
        team_b_p = teams_nested[b_idx]
        second = MeetupMatch(
            meetup_id=meetup_id,
            match_number=len(pitch_matches) + 1,
            team_a_users=json.dumps([p["user_id"] for p in team_a_p]),
            team_b_users=json.dumps([p["user_id"] for p in team_b_p]),
            team_a_name=(
                team_names[a_idx] if a_idx < len(team_names) else f"Team {a_idx + 1}"
            ),
            team_b_name=(
                team_names[b_idx] if b_idx < len(team_names) else f"Team {b_idx + 1}"
            ),
            score_a=0,
            score_b=0,
            status="pending",
            timer_total_seconds=match_duration * 60,
            timer_seconds_remaining=None,
        )
        db.add(second)
        pitch_matches.append(second)

    await db.commit()
    await db.refresh(match)
    for m in pitch_matches[1:]:
        await db.refresh(m)

    log_action(
        request,
        "match",
        "match.started",
        "Started matches: "
        + "; ".join(
            f"{m.team_a_name} vs {m.team_b_name}" for m in pitch_matches
        ),
        meetup_id=meetup_id,
    )

    # Notify
    await bump_and_notify(db, meetup_id)
    for m in pitch_matches:
        await _broadcast_match_event(
            meetup_id,
            {
                "type": "match_created",
                "match_id": m.id,
                "match_number": m.match_number,
            },
        )

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return {
        "status": "started",
        "match": _match_json(match, users_by_id),
        "matches": [_match_json(m, users_by_id) for m in pitch_matches],
    }


async def _sideline_additions(db: AsyncSession, match_ids: list[int]) -> dict[int, set[int]]:
    additions: dict[int, set[int]] = {}
    rows = await db.scalars(select(MatchSubstitution).where(
        MatchSubstitution.match_id.in_(match_ids), MatchSubstitution.is_sideline_addition.is_(True),
    ))
    for row in rows:
        before = set(_loads_int_list(row.old_team_a_users) + _loads_int_list(row.old_team_b_users))
        after = set(_loads_int_list(row.new_team_a_users) + _loads_int_list(row.new_team_b_users))
        additions.setdefault(row.match_id, set()).update(after - before)
    return additions


async def _rotation_teams(
    db: AsyncSession, matches: Sequence[MeetupMatch],
    teams: list[list[dict]], names: list[str] | None,
) -> tuple[dict[int, set[int]], set[int]]:
    """Identify teams that played without carrying borrowed players forward."""
    additions = await _sideline_additions(db, [match.id for match in matches])
    used = set()
    for match in matches:
        borrowed = additions.get(match.id, set())
        played = (
            set(_loads_int_list(match.team_a_users)) - borrowed,
            set(_loads_int_list(match.team_b_users)) - borrowed,
        )
        for idx, team in enumerate(teams):
            name = names[idx] if names and idx < len(names) else _team_name(idx + 1)
            if {p["user_id"] for p in team} in played or (
                borrowed and name in (match.team_a_name, match.team_b_name)
            ):
                used.add(idx)
    return additions, used


@router.post("/{meetup_id}/matches/new", status_code=201)
async def create_new_pending_match(
    meetup_id: int,
    request: Request,
    body: CreatePendingMatchBody | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_present_member),
):
    """Create a fresh pending match for the next round.

    Accepts optional team_a_idx and team_b_idx to pick specific teams.
    If not provided, picks the last match winner as team A and the next
    unplayed (or any available) team as team B.
    """
    meetup = await db.get(Meetup, meetup_id)
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    body = body or CreatePendingMatchBody()
    if (body.team_a_idx is None) != (body.team_b_idx is None):
        raise HTTPException(
            status_code=400,
            detail="Provide both team_a_idx and team_b_idx, or neither.",
        )

    # Find the last match to determine match number
    existing = await db.execute(
        select(MeetupMatch)
        .where(MeetupMatch.meetup_id == meetup_id)
        .order_by(MeetupMatch.match_number.desc())
        .limit(1)
    )
    last_match = existing.scalar_one_or_none()
    if not last_match or last_match.status != "completed":
        raise HTTPException(
            status_code=400,
            detail="No completed match to build from. Start matches first.",
        )

    # Load confirmed players and resolve teams
    result = await db.execute(
        select(User)
        .join(Attendance, Attendance.user_id == User.id)
        .where(
            Attendance.meetup_id == meetup_id,
            Attendance.status == "confirmed",
        )
    )
    confirmed_users = result.scalars().all()
    computed_scores = (await get_rating_settings(db)).computed_scores
    players = [
        {
            "id": str(u.id),
            "name": u.display_name,
            "skill": draft_skill(selected_rating(u, computed_scores)),
            "user_id": u.id,
            "avatar_url": u.avatar_url,
            "primary_specialty": u.primary_specialty,
            "secondary_specialty": u.secondary_specialty,
            "calculated_skill": selected_rating(u, computed_scores),
            "pac": u.pac,
            "dri": u.dri,
        }
        for u in confirmed_users
    ]

    mode = getattr(meetup, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_meetup_teams_nested(
        getattr(meetup, "manual_teams_json", None),
        mode,
        players,
        max_teams=getattr(meetup, "max_teams", None),
        team_size=meetup.team_size,
    )
    team_names = get_team_names(meetup)

    if body.team_a_idx is not None and body.team_b_idx is not None:
        # User-selected teams
        if body.team_a_idx < 0 or body.team_a_idx >= len(teams_nested):
            raise HTTPException(status_code=400, detail="Invalid team_a_idx.")
        if body.team_b_idx < 0 or body.team_b_idx >= len(teams_nested):
            raise HTTPException(status_code=400, detail="Invalid team_b_idx.")
        if body.team_a_idx == body.team_b_idx:
            raise HTTPException(status_code=400, detail="Teams must be different.")
        if meetup.max_teams and meetup.team_size and (body.team_a_idx >= meetup.max_teams or body.team_b_idx >= meetup.max_teams):
            raise HTTPException(status_code=400, detail="Bench cannot play as a team.")
        team_a = teams_nested[body.team_a_idx]
        team_b = teams_nested[body.team_b_idx]
        team_a_name = (
            team_names[body.team_a_idx]
            if team_names and body.team_a_idx < len(team_names)
            else _team_name(body.team_a_idx + 1)
        )
        team_b_name = (
            team_names[body.team_b_idx]
            if team_names and body.team_b_idx < len(team_names)
            else _team_name(body.team_b_idx + 1)
        )
        team_a_users_list = [p["user_id"] for p in team_a]
        team_b_users_list = [p["user_id"] for p in team_b]
    else:
        # Auto-pick: bracket-aware.
        # Round 1 complete (both pitch matches finished) -> the final
        # (winner of pitch 1 vs winner of pitch 2).
        # Final complete -> the loser match (loser of pitch 1 vs loser of pitch 2).
        # Otherwise -> last match winner vs next unplayed team (legacy).
        all_matches = await db.execute(
            select(MeetupMatch)
            .where(MeetupMatch.meetup_id == meetup_id)
            .order_by(MeetupMatch.match_number.asc())
        )
        played_matches = all_matches.scalars().all()
        completed = [m for m in played_matches if m.status == "completed"]

        def _winner_of(m: MeetupMatch) -> tuple[list[int], str]:
            if m.penalty_winner == "a":
                return _loads_int_list(m.team_a_users), m.team_a_name
            if m.penalty_winner == "b":
                return _loads_int_list(m.team_b_users), m.team_b_name
            if m.score_a > m.score_b:
                return _loads_int_list(m.team_a_users), m.team_a_name
            return _loads_int_list(m.team_b_users), m.team_b_name

        def _loser_of(m: MeetupMatch) -> tuple[list[int], str]:
            w, _ = _winner_of(m)
            a = _loads_int_list(m.team_a_users)
            b = _loads_int_list(m.team_b_users)
            if set(a) == set(w):
                return b, m.team_b_name
            return a, m.team_a_name

        if len(completed) == 2 and len(played_matches) == 2:
            # Round 1 done -> the final
            m1, m2 = completed[0], completed[1]
            team_a_users_list, team_a_name = _winner_of(m1)
            team_b_users_list, team_b_name = _winner_of(m2)
        elif len(completed) == 3 and len(played_matches) == 3:
            # Final done -> the loser match
            m1, m2 = completed[0], completed[1]
            team_a_users_list, team_a_name = _loser_of(m1)
            team_b_users_list, team_b_name = _loser_of(m2)
        else:
            # Legacy: last match winner vs next unplayed team. A tied match
            # with a shootout winner pairs the shootout winner with the loser.
            winner_users, winner_name = _winner_of(last_match)
            borrowed, used_team_indices = await _rotation_teams(db, played_matches, teams_nested, team_names)
            winner_users = [uid for uid in winner_users if uid not in borrowed.get(last_match.id, ())]

            if last_match.penalty_winner is not None:
                # Shootout decided — the winner stays on the pitch against the loser.
                loser_users, loser_name = _loser_of(last_match)
                loser_users = [uid for uid in loser_users if uid not in borrowed.get(last_match.id, ())]
                team_a_users_list = winner_users
                team_a_name = winner_name
                team_b_users_list = loser_users
                team_b_name = loser_name
            else:
                import random as _random

                # A bench team (partition larger than max_teams) is not a playing
                # candidate — it exists for pre-start substitutions only.
                bench_idx = (
                    len(teams_nested) - 1
                    if meetup.max_teams and len(teams_nested) > meetup.max_teams
                    else None
                )
                unplayed_indices = [
                    idx
                    for idx in range(len(teams_nested))
                    if idx not in used_team_indices and idx != bench_idx
                ]
                if unplayed_indices:
                    next_team_idx = unplayed_indices[0]
                else:
                    available = [
                        idx
                        for idx in range(len(teams_nested))
                        if idx != bench_idx
                        and set(p["user_id"] for p in teams_nested[idx]) != set(winner_users)
                    ]
                    if not available:
                        raise HTTPException(
                            status_code=400,
                            detail="Not enough teams for another match.",
                        )
                    next_team_idx = _random.choice(available)

                team_a_users_list = winner_users  # already a list of ints
                team_b = teams_nested[next_team_idx]
                team_a_name = winner_name
                team_b_name = (
                    team_names[next_team_idx]
                    if team_names and next_team_idx < len(team_names)
                    else _team_name(next_team_idx + 1)
                )
                team_b_users_list = [p["user_id"] for p in team_b]

    match_duration = meetup.match_duration_minutes or 10

    new_match = MeetupMatch(
        meetup_id=meetup_id,
        match_number=last_match.match_number + 1,
        team_a_users=json.dumps(team_a_users_list),
        team_b_users=json.dumps(team_b_users_list),
        team_a_name=team_a_name,
        team_b_name=team_b_name,
        score_a=0,
        score_b=0,
        status="pending",
        timer_total_seconds=match_duration * 60,
    )
    db.add(new_match)
    await db.commit()
    await db.refresh(new_match)
    log_action(
        request,
        "match",
        "match.created_pending",
        f"Created match #{new_match.match_number}: "
        f"{new_match.team_a_name} vs {new_match.team_b_name}",
        meetup_id=meetup_id,
    )

    await bump_and_notify(db, meetup_id)

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return {"status": "created", "match": _match_json(new_match, users_by_id)}


@router.delete("/{meetup_id}/matches/{match_id}", status_code=204)
async def delete_match(
    meetup_id: int,
    match_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Delete a match (admin only)."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    from app.services.deletes import delete_match_children

    del_number = match.match_number
    del_teams = f"{match.team_a_name} vs {match.team_b_name} ({match.score_a}-{match.score_b})"
    await delete_match_children(db, match_id)
    await db.delete(match)
    if match.status == "completed":
        await refresh_skills_after_meetup(db, meetup_id)
    await db.commit()
    await bump_and_notify(db, meetup_id)
    log_action(
        request,
        "match",
        "match.deleted",
        f"Deleted match #{del_number} ({del_teams}) and its goals and penalties",
        meetup_id=meetup_id,
    )


@router.post("/{meetup_id}/matches/create", status_code=201)
async def create_match(
    meetup_id: int,
    body: MatchCreateBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_present_member),
):
    """Create a completed match directly (admin, for retroactive score entry)."""
    meetup = await db.get(Meetup, meetup_id)
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    # Find the next match number
    existing = await db.execute(
        select(MeetupMatch)
        .where(MeetupMatch.meetup_id == meetup_id)
        .order_by(MeetupMatch.match_number.desc())
        .limit(1)
    )
    last = existing.scalar_one_or_none()
    next_num = (last.match_number + 1) if last else 1

    # Prevent a team from playing itself
    if body.team_a_name.lower() == body.team_b_name.lower():
        raise HTTPException(
            status_code=400,
            detail="Team A and Team B must be different.",
        )

    roster = body.team_a_users + body.team_b_users
    if len(roster) != len(set(roster)):
        raise HTTPException(status_code=400, detail="A player can only appear once in the match.")
    if roster:
        confirmed = set(await db.scalars(
            select(Attendance.user_id).where(
                Attendance.meetup_id == meetup_id,
                Attendance.status == "confirmed",
            )
        ))
        if not confirmed.issuperset(roster):
            raise HTTPException(status_code=400, detail="Every player must be confirmed for this meetup.")

    match = MeetupMatch(
        meetup_id=meetup_id,
        match_number=next_num,
        team_a_users=json.dumps(body.team_a_users),
        team_b_users=json.dumps(body.team_b_users),
        team_a_name=body.team_a_name,
        team_b_name=body.team_b_name,
        score_a=body.score_a,
        score_b=body.score_b,
        status="completed",
        timer_total_seconds=0,
        timer_seconds_remaining=None,
        completed_at=datetime.now(UTC),
    )
    db.add(match)
    await db.commit()
    await db.refresh(match)
    log_action(
        request,
        "match",
        "match.created_retro",
        f"Retroactively created match #{match.match_number}: "
        f"{match.team_a_name} {match.score_a}-{match.score_b} {match.team_b_name}",
        meetup_id=meetup_id,
    )

    await bump_and_notify(db, meetup_id)

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return {"status": "created", "match": _match_json(match, users_by_id)}


@router.patch("/{meetup_id}/matches/{match_id}/teams")
async def swap_match_teams(
    meetup_id: int,
    match_id: int,
    body: MatchTeamSwap,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_present_member),
):
    """Swap players or borrow a confirmed sideline player while play is stopped.

    Records a before/after snapshot in match_substitutions (for rankings);
    pre-start swaps are also persisted to meetup.manual_teams_json so future
    rounds inherit them (mid-match swaps are match-local). Mid-match rows
    carry the match clock, which drives ≥50%-played credit in rankings.
    A sideline addition applies to this match only.
    """
    if body.add_sideline_player and not request.state.is_admin:
        raise HTTPException(status_code=403, detail="Only admins can add a sideline player.")
    await db.execute(text("BEGIN IMMEDIATE"))
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status not in ("pending", "active"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot swap teams for a {match.status} match.",
        )
    if match.status == "active" and not _is_currently_paused(match):
        raise HTTPException(
            status_code=409, detail="Pause the timer to substitute mid-match."
        )

    old_a = _loads_int_list(match.team_a_users)
    old_b = _loads_int_list(match.team_b_users)
    new_a, new_b = list(body.team_a_users), list(body.team_b_users)
    old_a_ids, old_b_ids = set(old_a), set(old_b)
    new_a_ids, new_b_ids = set(new_a), set(new_b)
    if len(new_a_ids | new_b_ids) != len(new_a) + len(new_b):
        raise HTTPException(status_code=400, detail="A player can only be on one side of the match.")
    if body.add_sideline_player:
        valid_addition = (
            old_a_ids < new_a_ids and old_b_ids == new_b_ids
            or old_b_ids < new_b_ids and old_a_ids == new_a_ids
        )
        if not valid_addition or len(new_a) + len(new_b) != len(old_a) + len(old_b) + 1:
            raise HTTPException(status_code=400, detail="Add one sideline player without moving anyone else.")
        added = (new_a_ids | new_b_ids) - (old_a_ids | old_b_ids)
        other_matches = await db.execute(select(MeetupMatch.team_a_users, MeetupMatch.team_b_users).where(
            MeetupMatch.meetup_id == meetup_id, MeetupMatch.id != match.id,
            MeetupMatch.status.in_(("pending", "active", "time_up")),
        ))
        if any(added.intersection(_loads_int_list(a) + _loads_int_list(b)) for a, b in other_matches):
            raise HTTPException(status_code=409, detail="That player is already in another match.")
    elif len(new_a) != len(old_a) or len(new_b) != len(old_b):
        raise HTTPException(
            status_code=400,
            detail="Substitutions must be 1-for-1 swaps: keep each team's size.",
        )
    confirmed = set(
        (
            await db.execute(
                select(User.id)
                .join(Attendance, Attendance.user_id == User.id)
                .where(
                    Attendance.meetup_id == meetup_id,
                    Attendance.status == "confirmed",
                )
            )
        ).scalars().all()
    )
    if not (set(new_a) | set(new_b)) <= confirmed:
        raise HTTPException(
            status_code=400, detail="Substituted players must be confirmed attendees."
        )

    # One-writer gate, same as goal entry: only the lease holder may swap.
    # Not released afterwards — the editing panel renews until it closes.
    lease = await db.get(MatchEditorLease, match.id)
    now = utcnow()
    if lease is None or lease.holder_id is None or lease.expires_at <= now:
        return await _lease_busy_response(db, match.id, now)
    if lease.holder_id != _user.id:
        return await _lease_busy_response(db, match.id, now)

    clock_secs = None
    if match.status == "active":
        # Stored remaining is authoritative while paused (only changes at
        # start/pause/resume) — the clock at this swap.
        clock_secs = match.timer_total_seconds - (match.timer_seconds_remaining or 0)
    db.add(
        MatchSubstitution(
            meetup_id=meetup_id,
            match_id=match.id,
            old_team_a_users=json.dumps(old_a),
            old_team_b_users=json.dumps(old_b),
            new_team_a_users=json.dumps(new_a),
            new_team_b_users=json.dumps(new_b),
            recorded_by=_user.id,
            clock_secs=clock_secs,
            is_sideline_addition=body.add_sideline_player,
        )
    )
    match.auto_queued = False
    match.team_a_users = json.dumps(new_a)
    match.team_b_users = json.dumps(new_b)

    if match.status == "pending" and not body.add_sideline_player and not await _sideline_additions(db, [match.id]):
        # Propagate the swap to the meetup-level partition (future rounds).
        await _propagate_swap_to_meetup(db, meetup_id, old_a, old_b, new_a, new_b)

    description = "Added a sideline player to" if body.add_sideline_player else "Substituted players in"
    await bump_and_notify(db, meetup_id)
    users_by_id = await _load_users_for_meetup(db, meetup_id)
    log_action(
        request,
        "match",
        "match.teams_swapped",
        f"{description} match #{match.match_number} "
        f"({match.team_a_name} vs {match.team_b_name})"
        + ("; mid-match" if match.status == "active" else "; pre-start"),
        meetup_id=meetup_id,
    )
    return _match_json(match, users_by_id)


async def _propagate_swap_to_meetup(
    db: AsyncSession,
    meetup_id: int,
    old_a: list[int],
    old_b: list[int],
    new_a: list[int],
    new_b: list[int],
) -> None:
    """Persist a pre-start swap to the meetup-level partition (future rounds)."""
    meetup = await db.get(Meetup, meetup_id)
    if meetup is None:
        return
    result = await db.execute(
        select(User)
        .join(Attendance, Attendance.user_id == User.id)
        .where(
            Attendance.meetup_id == meetup_id,
            Attendance.status == "confirmed",
        )
    )
    confirmed_users = result.scalars().all()
    computed_scores = (await get_rating_settings(db)).computed_scores
    players = [
        {
            "id": str(u.id),
            "name": u.display_name,
            "skill": draft_skill(selected_rating(u, computed_scores)),
            "user_id": u.id,
            "avatar_url": u.avatar_url,
            "primary_specialty": u.primary_specialty,
            "secondary_specialty": u.secondary_specialty,
            "calculated_skill": selected_rating(u, computed_scores),
            "pac": u.pac,
            "dri": u.dri,
        }
        for u in confirmed_users
    ]
    meetup.manual_teams_json = apply_roster_swap(
        meetup.manual_teams_json,
        getattr(meetup, "team_assignment_mode", None) or "balanced",
        players,
        old_a,
        old_b,
        new_a,
        new_b,
        max_teams=meetup.max_teams,
        team_size=meetup.team_size,
    )


@router.get("/{meetup_id}/matches/{match_id}/substitutions")
async def list_match_substitutions(
    meetup_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Substitution history for one match, oldest first."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    return {"substitutions": await _match_substitution_log(db, match_id)}


async def _match_substitution_log(db: AsyncSession, match_id: int) -> list[dict]:
    rows = (
        await db.execute(
            select(MatchSubstitution)
            .where(MatchSubstitution.match_id == match_id)
            .order_by(
                MatchSubstitution.created_at.asc(),
                MatchSubstitution.id.asc(),
            )
        )
    ).scalars().all()
    by_id = {s.recorded_by: await db.get(User, s.recorded_by) for s in rows}
    return [
        {
            "id": s.id,
            "recorded_by": by_id[s.recorded_by].display_name
            if by_id[s.recorded_by]
            else None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "clock_secs": s.clock_secs,
            "old_team_a_users": _loads_int_list(s.old_team_a_users),
            "old_team_b_users": _loads_int_list(s.old_team_b_users),
            "new_team_a_users": _loads_int_list(s.new_team_a_users),
            "new_team_b_users": _loads_int_list(s.new_team_b_users),
        }
        for s in rows
    ]


@router.post("/{meetup_id}/matches/{match_id}/substitutions")
async def record_historical_substitution(
    meetup_id: int,
    match_id: int,
    body: HistoricalLineupChange,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Correct a kickoff lineup or insert a timed substitution in one completed match."""
    await db.execute(text("BEGIN IMMEDIATE"))
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status != "completed":
        raise HTTPException(status_code=409, detail="Only completed matches can be edited here")
    lease = await db.get(MatchEditorLease, match_id)
    if lease and lease.holder_id is not None and lease.expires_at > utcnow():
        raise HTTPException(status_code=409, detail="A referee is editing this match. Try again shortly.")

    elapsed = body.elapsed_seconds
    if elapsed is not None:
        if not match.timer_total_seconds:
            meetup = await db.get(Meetup, meetup_id)
            match.timer_total_seconds = (meetup.match_duration_minutes or 10) * 60
        if match.timer_seconds_remaining != 0 and match.timer_started_at and match.completed_at:
            # An early finish may have left the last pause or kickoff value in the timer.
            match.timer_seconds_remaining = _compute_timer_remaining(match, at=match.completed_at)
        duration = match.timer_total_seconds - (match.timer_seconds_remaining or 0)
        if elapsed >= duration:
            raise HTTPException(status_code=400, detail="Enter an elapsed time before the match ended.")

    timed = list(await db.scalars(
        select(MatchSubstitution).where(
            MatchSubstitution.match_id == match.id,
            MatchSubstitution.clock_secs.is_not(None),
        ).order_by(MatchSubstitution.clock_secs, MatchSubstitution.id)
    ))
    earlier = [row for row in timed if elapsed is not None and row.clock_secs <= elapsed]
    if earlier:
        old = [_loads_int_list(earlier[-1].new_team_a_users), _loads_int_list(earlier[-1].new_team_b_users)]
    elif timed:
        old = [_loads_int_list(timed[0].old_team_a_users), _loads_int_list(timed[0].old_team_b_users)]
    else:
        old = [_loads_int_list(match.team_a_users), _loads_int_list(match.team_b_users)]

    side = 0 if body.team == "a" else 1
    if body.player_off == body.player_on:
        raise HTTPException(status_code=400, detail="Select a player to take off or put on.")
    if body.player_off is not None and body.player_off not in old[side]:
        raise HTTPException(status_code=409, detail="That player was not on this team at the selected time.")
    if body.swap_teams:
        if body.player_off is None or body.player_on not in old[1 - side]:
            raise HTTPException(status_code=409, detail="Select one player from each team at this match time.")
    elif body.player_on is not None:
        if body.player_on in old[0] or body.player_on in old[1]:
            raise HTTPException(status_code=409, detail="That player was already on the pitch at the selected time.")
        attendance = await db.scalar(select(Attendance.id).where(
            Attendance.user_id == body.player_on,
            Attendance.meetup_id == meetup_id,
            Attendance.status == "confirmed",
        ))
        if attendance is None:
            raise HTTPException(status_code=400, detail="The incoming player must be a confirmed attendee.")

    current = [team.copy() for team in old]
    if body.player_off is not None:
        current[side].remove(body.player_off)
    if body.player_on is not None:
        current[side].append(body.player_on)
    if body.swap_teams:
        current[1 - side].remove(body.player_on)
        current[1 - side].append(body.player_off)
    db.add(MatchSubstitution(
        meetup_id=meetup_id, match_id=match_id, recorded_by=user.id, clock_secs=elapsed,
        old_team_a_users=json.dumps(old[0]), old_team_b_users=json.dumps(old[1]),
        new_team_a_users=json.dumps(current[0]), new_team_b_users=json.dumps(current[1]),
    ))

    # Preserve later substitutions by applying their original moves to the corrected lineup.
    for row in timed[len(earlier):]:
        row_before = [_loads_int_list(row.old_team_a_users), _loads_int_list(row.old_team_b_users)]
        row_after = [_loads_int_list(row.new_team_a_users), _loads_int_list(row.new_team_b_users)]
        updated = []
        for team, before, after in zip(current, row_before, row_after, strict=True):
            removed = set(before) - set(after)
            added = [uid for uid in after if uid not in before]
            if not removed <= set(team) or any(uid in team for uid in added):
                raise HTTPException(status_code=409, detail="This change conflicts with a later substitution.")
            updated.append([uid for uid in team if uid not in removed] + added)
        if set(updated[0]).intersection(updated[1]):
            raise HTTPException(status_code=409, detail="This change conflicts with a later substitution.")
        row.old_team_a_users, row.old_team_b_users = map(json.dumps, current)
        row.new_team_a_users, row.new_team_b_users = map(json.dumps, updated)
        current = updated

    match.team_a_users, match.team_b_users = map(json.dumps, current)
    await refresh_skills_after_meetup(db, meetup_id)
    result = {
        "match": _match_json(match, await _load_users_for_meetup(db, meetup_id)),
        "substitutions": await _match_substitution_log(db, match_id),
    }
    await bump_and_notify(db, meetup_id)
    log_action(
        request, "match", "match.historical_lineup_updated",
        f"Updated the lineup for match #{match.match_number}",
        meetup_id=meetup_id,
    )
    return result


# ── Penalty shootout (tied first match) ────────────────────────────


def _shootout_winner(shots: list[tuple[str, bool]]) -> str | None:
    """First side with an uncatchable lead, if any.

    Standard rules: five shots per side, then sudden death — a lead bigger
    than the opponent's remaining shots of their five clinches it.
    """
    a = b = taken_a = taken_b = 0
    for team, scored in shots:
        if team == "a":
            a += int(scored)
            taken_a += 1
        else:
            b += int(scored)
            taken_b += 1
        if a > b and a - b > max(0, 5 - taken_b):
            return "a"
        if b > a and b - a > max(0, 5 - taken_a):
            return "b"
    return None


async def _penalty_base(db: AsyncSession, meetup_id: int, match_id: int):
    """Match + ordered shots, validated for an open shootout."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status != "completed" or match.match_number != 1:
        raise HTTPException(
            status_code=409, detail="The shootout is for the first match only."
        )
    if match.score_a != match.score_b:
        raise HTTPException(status_code=409, detail="The match did not end in a draw.")
    shots = list(
        (
            await db.execute(
                select(MatchPenalty)
                .where(MatchPenalty.match_id == match.id)
                .order_by(MatchPenalty.id.asc())
            )
        )
        .scalars()
        .all()
    )
    return match, shots


def _penalty_json(match: MeetupMatch, shots: list[MatchPenalty], users_by_id: dict[int, dict]) -> dict:
    return {
        "available": (
            match.status == "completed"
            and match.match_number == 1
            and match.score_a == match.score_b
            and match.penalty_winner is None
            and not match.penalty_skipped
        ),
        "winner": match.penalty_winner,
        "shots": [
            {
                "id": s.id,
                "team": s.team,
                "scored": s.scored,
                "scorer": users_by_id.get(
                    s.scorer_id,
                    {"id": s.scorer_id, "display_name": f"User {s.scorer_id}"},
                ),
            }
            for s in shots
        ],
        "counts": {
            "a": sum(1 for s in shots if s.team == "a"),
            "b": sum(1 for s in shots if s.team == "b"),
        },
        "decided": _shootout_winner([(s.team, s.scored) for s in shots]) is not None,
    }


@router.get("/{meetup_id}/matches/{match_id}/penalty")
async def get_penalty_shootout(
    meetup_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
):
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    shots = list(
        (
            await db.execute(
                select(MatchPenalty)
                .where(MatchPenalty.match_id == match.id)
                .order_by(MatchPenalty.id.asc())
            )
        )
        .scalars()
        .all()
    )
    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return _penalty_json(match, shots, users_by_id)


@router.post("/{meetup_id}/matches/{match_id}/penalty/shots")
async def add_penalty_shot(
    meetup_id: int,
    match_id: int,
    body: PenaltyShotBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_present_member),
):
    await db.execute(text("BEGIN IMMEDIATE"))
    match, shots = await _penalty_base(db, meetup_id, match_id)
    if match.penalty_winner is not None or match.penalty_skipped:
        raise HTTPException(status_code=409, detail="The shootout is already finished.")
    n_a = sum(1 for s in shots if s.team == "a")
    n_b = len(shots) - n_a
    next_team = "a" if n_a == n_b else "b"
    if body.team != next_team:
        raise HTTPException(status_code=400, detail=f"Team {next_team.upper()} shoots next.")
    roster = set(
        _loads_int_list(match.team_a_users if body.team == "a" else match.team_b_users)
    )
    if body.scorer_id not in roster:
        raise HTTPException(status_code=400, detail="Scorer must be on the shooting team.")
    shot = MatchPenalty(
        match_id=match.id, team=body.team, scored=body.scored, scorer_id=body.scorer_id
    )
    db.add(shot)
    await db.commit()
    shots.append(shot)
    users_by_id = await _load_users_for_meetup(db, meetup_id)
    scorer = users_by_id.get(shot.scorer_id, {}).get("name", str(shot.scorer_id))
    log_action(
        request,
        "referee",
        "referee.penalty_shot",
        f"Penalty #{len(shots)} in match #{match.match_number}: "
        f"{scorer} ({shot.team.upper()}) {'scored' if shot.scored else 'missed'}",
        meetup_id=meetup_id,
    )
    await _broadcast_match_event(
        meetup_id,
        {"type": "match_penalty_shots", "match_id": match.id},
    )
    return _penalty_json(match, shots, users_by_id)


@router.post("/{meetup_id}/matches/{match_id}/penalty/undo")
async def undo_penalty_shot(
    meetup_id: int,
    match_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_present_member),
):
    await db.execute(text("BEGIN IMMEDIATE"))
    match, shots = await _penalty_base(db, meetup_id, match_id)
    if match.penalty_winner is not None or match.penalty_skipped:
        raise HTTPException(status_code=409, detail="The shootout is already finished.")
    if not shots:
        raise HTTPException(status_code=400, detail="No shots to undo.")
    undone = shots[-1]
    await db.execute(delete(MatchPenalty).where(MatchPenalty.id == undone.id))
    await db.commit()
    log_action(
        request,
        "referee",
        "referee.penalty_undone",
        f"Undid penalty #{len(shots)} "
        f"({undone.team.upper()}) in match #{match.match_number}",
        meetup_id=meetup_id,
    )
    await _broadcast_match_event(
        meetup_id,
        {"type": "match_penalty_shots", "match_id": match.id},
    )
    shots.pop()
    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return _penalty_json(match, shots, users_by_id)


@router.post("/{meetup_id}/matches/{match_id}/penalty/finish")
async def finish_penalty_shootout(
    meetup_id: int,
    match_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_present_member),
):
    """Lock in the shootout winner: they take the de-facto match win and
    stay on the pitch for the next match."""
    await db.execute(text("BEGIN IMMEDIATE"))
    match, shots = await _penalty_base(db, meetup_id, match_id)
    if match.penalty_winner is not None or match.penalty_skipped:
        raise HTTPException(status_code=409, detail="The shootout is already finished.")
    winner = _shootout_winner([(s.team, s.scored) for s in shots])
    if winner is None:
        raise HTTPException(status_code=400, detail="The shootout is not decided yet.")
    match.penalty_winner = winner

    # The referee starts the next match manually; the shootout winner is
    # recorded on this match (penalty_winner) so the next match picks them up.
    await db.flush()
    await db.commit()
    await _broadcast_match_event(
        meetup_id,
        {"type": "match_penalty_finished", "match_id": match.id, "winner": winner},
    )
    users_by_id = await _load_users_for_meetup(db, meetup_id)
    log_action(
        request,
        "referee",
        "referee.penalty_finished",
        f"Penalty shootout in match #{match.match_number} finished: "
        f"{match.team_a_name if winner == 'a' else match.team_b_name} wins",
        meetup_id=meetup_id,
    )
    return {"winner": winner, "match": _match_json(match, users_by_id)}


@router.post("/{meetup_id}/matches/{match_id}/penalty/skip")
async def skip_penalty_shootout(
    meetup_id: int,
    match_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_present_member),
):
    await db.execute(text("BEGIN IMMEDIATE"))
    match, _ = await _penalty_base(db, meetup_id, match_id)
    if match.penalty_winner is not None or match.penalty_skipped:
        raise HTTPException(status_code=409, detail="The shootout is already finished.")
    await db.execute(delete(MatchPenalty).where(MatchPenalty.match_id == match.id))
    match.penalty_skipped = True
    await db.commit()
    log_action(request, "referee", "referee.penalty_skipped",
               f"Skipped penalty shootout in match #{match.match_number}", meetup_id=meetup_id)
    await _broadcast_match_event(meetup_id, {"type": "match_penalty_finished", "match_id": match.id})
    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return _penalty_json(match, [], users_by_id)


@router.post("/{meetup_id}/matches/{match_id}/timer/start")
async def start_timer(
    meetup_id: int,
    match_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_present_member),
):
    """Start the match timer (any present member, idempotent)."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status == "completed":
        raise HTTPException(status_code=409, detail="This match is completed.")
    if match.status == "time_up":
        raise HTTPException(
            status_code=409,
            detail="Time is up — use timer/reset to restart the match.",
        )
    if match.status == "active":
        # Double tap: never restart a running/paused timer.
        return {
            "status": "active",
            "already": True,
            "seconds_remaining": _compute_timer_remaining(match),
            "timer_paused": _is_currently_paused(match),
            "ends_at": _timer_ends_at_iso(match),
            "controlled_by": {"name": user.display_name},
        }

    if match.match_number > 1:
        first = (await db.execute(select(MeetupMatch).where(
            MeetupMatch.meetup_id == meetup_id,
            MeetupMatch.match_number == 1,
            MeetupMatch.status == "completed",
        ))).scalar_one_or_none()
        if (first and first.score_a == first.score_b
                and first.penalty_winner is None and not first.penalty_skipped):
            raise HTTPException(status_code=409, detail="Finish or skip the first match shootout before starting the next match.")

    if not _loads_int_list(match.team_a_users) or not _loads_int_list(match.team_b_users):
        meetup = await db.get(Meetup, meetup_id)
        if meetup and meetup.team_size is not None:
            await fill_empty_pending_matches(db, meetup)
            if not _loads_int_list(match.team_a_users) or not _loads_int_list(match.team_b_users):
                raise HTTPException(status_code=409, detail="Both teams need a player before starting the timer.")

    match.timer_started_at = datetime.now(UTC)
    match.timer_seconds_remaining = match.timer_total_seconds
    match.timer_pause_intervals = "[]"
    match.status = "active"
    await db.commit()
    log_action(
        request,
        "referee",
        "referee.timer_started",
        f"Started the clock for match #{match.match_number} "
        f"({match.team_a_name} vs {match.team_b_name})",
        meetup_id=meetup_id,
    )

    await _broadcast_match_event(
        meetup_id,
        {
            "type": "match_timer_started",
            "match_id": match.id,
            "seconds_remaining": match.timer_total_seconds,
            "status": "active",
            "ends_at": _timer_ends_at_iso(match),
        },
    )

    await bump_and_notify(db, meetup_id)

    return {
        "status": "started",
        "already": False,
        "seconds_remaining": match.timer_total_seconds,
        "timer_paused": False,
        "ends_at": _timer_ends_at_iso(match),
        "controlled_by": {"name": user.display_name},
    }


@router.post("/{meetup_id}/matches/{match_id}/timer/pause")
async def pause_timer(
    meetup_id: int,
    match_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_present_member),
):
    """Pause the match timer (any present member, idempotent)."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status not in ("active",):
        raise HTTPException(status_code=409, detail="Timer is not running.")
    if _is_currently_paused(match):
        # Double tap: no second interval is appended (the old bug).
        return {
            "status": "paused",
            "already": True,
            "seconds_remaining": _compute_timer_remaining(match),
            "timer_paused": True,
            "ends_at": None,
            "controlled_by": {"name": user.display_name},
        }

    now = datetime.now(UTC)
    remaining = _compute_timer_remaining(match)

    intervals: list[dict] = []
    if match.timer_pause_intervals:
        try:
            intervals = json.loads(match.timer_pause_intervals)
        except json.JSONDecodeError, TypeError:
            pass
    intervals.append({"paused_at": now.isoformat(), "resumed_at": None})
    new_intervals = json.dumps(intervals)

    # Check-and-append as ONE conditional UPDATE: it only applies when no
    # open pause interval exists, so a racing double-tap loses rowcount 0
    # and takes the idempotent path below — two open intervals (pause time
    # subtracted twice) cannot be committed.
    res = await db.execute(
        text(
            """
            UPDATE meetup_matches
               SET timer_pause_intervals = :iv,
                   timer_seconds_remaining = :rem
             WHERE id = :mid
               AND (
                 timer_pause_intervals IS NULL
                 OR timer_pause_intervals = ''
                 OR NOT EXISTS (
                    SELECT 1 FROM json_each(meetup_matches.timer_pause_intervals)
                    WHERE json_extract(json_each.value, '$.resumed_at') IS NULL
                 )
               )
            """
        ),
        {"iv": new_intervals, "rem": remaining, "mid": match.id},
    )
    if cast(CursorResult, res).rowcount == 0:
        # Lost the race / already paused: idempotent, no second interval.
        return {
            "status": "paused",
            "already": True,
            "seconds_remaining": _compute_timer_remaining(match),
            "timer_paused": True,
            "ends_at": None,
            "controlled_by": {"name": user.display_name},
        }
    match.timer_pause_intervals = new_intervals
    match.timer_seconds_remaining = remaining
    await db.commit()
    minute = (match.timer_total_seconds - remaining) // 60
    log_action(
        request,
        "referee",
        "referee.timer_paused",
        f"Paused the clock for match #{match.match_number} at minute {minute}",
        meetup_id=meetup_id,
    )

    await _broadcast_match_event(
        meetup_id,
        {
            "type": "match_timer_paused",
            "match_id": match.id,
            "seconds_remaining": remaining,
            "ends_at": None,
        },
    )

    await bump_and_notify(db, meetup_id)

    return {
        "status": "paused",
        "already": False,
        "seconds_remaining": remaining,
        "timer_paused": True,
        "ends_at": None,
        "controlled_by": {"name": user.display_name},
    }


@router.post("/{meetup_id}/matches/{match_id}/timer/adjust")
async def adjust_timer(
    meetup_id: int,
    match_id: int,
    body: TimerAdjustment,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_present_member),
):
    """Adjust a paused timer without changing the match duration."""
    await db.execute(text("BEGIN IMMEDIATE"))
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status != "active" or match.timer_started_at is None or not _is_currently_paused(match):
        raise HTTPException(status_code=409, detail="Timer must be paused.")
    intervals = json.loads(match.timer_pause_intervals)
    remaining = match.timer_seconds_remaining
    if remaining is None:
        remaining = _compute_timer_remaining(match)
    adjusted = max(0, min(600, remaining + body.delta_seconds))
    intervals[-1]["adjustment_seconds"] = intervals[-1].get("adjustment_seconds", 0) + adjusted - remaining
    match.timer_pause_intervals = json.dumps(intervals)
    match.timer_seconds_remaining = adjusted
    await db.commit()
    log_action(request, "referee", "referee.timer_adjusted",
               f"Adjusted the clock for match #{match.match_number} to {adjusted} seconds",
               meetup_id=meetup_id)
    await _broadcast_match_event(meetup_id, {
        "type": "match_timer_paused", "match_id": match.id,
        "seconds_remaining": adjusted, "ends_at": None,
    })
    await bump_and_notify(db, meetup_id)
    return {"status": "paused", "seconds_remaining": adjusted, "timer_paused": True,
            "ends_at": None, "controlled_by": {"name": user.display_name}}


@router.post("/{meetup_id}/matches/{match_id}/timer/resume")
async def resume_timer(
    meetup_id: int,
    match_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_present_member),
):
    """Resume the match timer (any present member, idempotent)."""
    await db.execute(text("BEGIN IMMEDIATE"))
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status not in ("active",) or match.timer_started_at is None:
        raise HTTPException(status_code=409, detail="Timer is not running.")
    if not _is_currently_paused(match):
        # Timer is already running — nothing to resume.
        return {
            "status": "running",
            "already": True,
            "seconds_remaining": _compute_timer_remaining(match),
            "timer_paused": False,
            "ends_at": _timer_ends_at_iso(match),
            "controlled_by": {"name": user.display_name},
        }

    intervals: list[dict] = []
    if match.timer_pause_intervals:
        try:
            intervals = json.loads(match.timer_pause_intervals)
        except json.JSONDecodeError, TypeError:
            pass

    if not intervals or intervals[-1].get("resumed_at") is not None:
        raise HTTPException(status_code=409, detail="Timer is not paused.")

    now = datetime.now(UTC)
    intervals[-1]["resumed_at"] = now.isoformat()
    match.timer_pause_intervals = json.dumps(intervals)

    remaining = _compute_timer_remaining(match)
    match.timer_seconds_remaining = remaining

    await db.commit()
    minute = (match.timer_total_seconds - remaining) // 60
    log_action(
        request,
        "referee",
        "referee.timer_resumed",
        f"Resumed the clock for match #{match.match_number} at minute {minute}",
        meetup_id=meetup_id,
    )

    await _broadcast_match_event(
        meetup_id,
        {
            "type": "match_timer_resumed",
            "match_id": match.id,
            "seconds_remaining": remaining,
            "ends_at": _timer_ends_at_iso(match),
        },
    )

    await bump_and_notify(db, meetup_id)

    return {
        "status": "resumed",
        "already": False,
        "seconds_remaining": remaining,
        "timer_paused": False,
        "ends_at": _timer_ends_at_iso(match),
        "controlled_by": {"name": user.display_name},
    }


@router.post("/{meetup_id}/matches/{match_id}/timer/reset")
async def reset_timer(
    meetup_id: int,
    match_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Reset timer and scores for a match (admin only, idempotent)."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status == "pending":
        return {
            "status": "pending",
            "already": True,
            "seconds_remaining": match.timer_total_seconds,
            "timer_paused": False,
            "ends_at": None,
            "controlled_by": {"name": user.display_name},
        }
    if match.status not in ("active", "time_up"):
        raise HTTPException(
            status_code=409, detail="Can only reset an active or time_up match."
        )

    # A reset restarts the match: soft-delete the old goals in the same tx so
    # the next recompute (COUNT of live goals) starts from 0, not from the
    # pre-reset rows.
    await db.execute(
        update(MatchGoal)
        .where(
            MatchGoal.match_id == match.id,
            MatchGoal.deleted_at.is_(None),
        )
        .values(deleted_at=utcnow())
    )
    match.timer_started_at = None
    match.timer_seconds_remaining = None
    match.timer_pause_intervals = None
    match.score_offset_a = 0
    match.score_offset_b = 0
    match.status = "pending"
    await db.flush()
    await _recompute_scores(db, match)
    await db.commit()
    log_action(
        request,
        "referee",
        "referee.timer_reset",
        f"Reset the clock and scores for match #{match.match_number}",
        meetup_id=meetup_id,
    )

    await _broadcast_match_event(
        meetup_id,
        {
            "type": "match_reset",
            "match_id": match.id,
        },
    )

    await bump_and_notify(db, meetup_id)

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return _match_json(match, users_by_id)


@router.post("/{meetup_id}/matches/{match_id}/score")
async def increment_score(
    meetup_id: int,
    match_id: int,
    body: MatchScoreDelta,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_present_member),
):
    """Increment score for a team (+1 by default)."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status not in ("active", "time_up"):
        raise HTTPException(
            status_code=409, detail="Can only score during an active match."
        )

    # Atomic read-modify-write at the SQL level: two devices tapping +1
    # can't lose each other's update (no read-modify-write in Python).
    col = MeetupMatch.score_a if body.team == "a" else MeetupMatch.score_b
    await db.execute(
        update(MeetupMatch)
        .where(MeetupMatch.id == match.id)
        .values({col.name: func.max(0, col + body.delta)})
    )
    await db.flush()
    await db.refresh(match)
    # Keep the manual offset consistent with the (now authoritative) score.
    count_a, count_b = await _goal_counts(db, match)
    if body.team == "a":
        match.score_offset_a = match.score_a - count_a
    else:
        match.score_offset_b = match.score_b - count_b
    await db.commit()
    log_action(
        request,
        "match",
        "match.score_incremented",
        f"Score {'+' if body.delta >= 0 else '−'}{abs(body.delta)} for "
        f"{match.team_a_name if body.team == 'a' else match.team_b_name} "
        f"in match #{match.match_number} → {match.score_a}-{match.score_b}",
        meetup_id=meetup_id,
    )

    await _broadcast_match_event(
        meetup_id,
        {
            "type": "match_score_updated",
            "match_id": match.id,
            "team": body.team,
            "score_a": match.score_a,
            "score_b": match.score_b,
        },
    )

    await bump_and_notify(db, meetup_id)

    return {
        "score_a": match.score_a,
        "score_b": match.score_b,
    }


@router.patch("/{meetup_id}/matches/{match_id}/score")
async def set_score(
    meetup_id: int,
    match_id: int,
    body: MatchScoreSet,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_present_member),
):
    """Set scores directly (bulk correction)."""
    await db.execute(text("BEGIN IMMEDIATE"))
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    _require_editable_goal_log(match)
    count_a, count_b = await _goal_counts(db, match)
    old_score = f"{match.score_a}-{match.score_b}"
    match.score_a = body.score_a
    match.score_b = body.score_b
    match.score_offset_a = body.score_a - count_a
    match.score_offset_b = body.score_b - count_b
    if match.status == "completed":
        await _update_completed_draw(db, match)
        await refresh_skills_after_meetup(db, meetup_id)
    await db.commit()
    log_action(
        request,
        "match",
        "match.score_set",
        f"Set score in match #{match.match_number} from {old_score} "
        f"to {match.score_a}-{match.score_b}",
        meetup_id=meetup_id,
    )

    await _broadcast_match_event(
        meetup_id,
        {
            "type": "match_score_updated",
            "match_id": match.id,
            "score_a": match.score_a,
            "score_b": match.score_b,
        },
    )

    await bump_and_notify(db, meetup_id)

    return {
        "score_a": match.score_a,
        "score_b": match.score_b,
    }


@router.post("/{meetup_id}/matches/{match_id}/end")
async def end_match(
    meetup_id: int,
    match_id: int,
    body: MatchEndBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_present_member),
):
    """End the current match. Winner stays on pitch; next team enters."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status in ("completed",):
        raise HTTPException(status_code=409, detail="Match already completed.")

    # Determine winner. A tie goes to the away team — the home side must win
    # to stay on the pitch (an explicit winner_team override is honoured).
    is_tie = match.score_a == match.score_b
    if match.score_a > match.score_b:
        winner_team = "a"
    elif not is_tie:
        winner_team = "b"
    else:
        winner_team = body.winner_team or "b"

    # Draws are only *recorded* (statistics) when the template allows them;
    # the away team wins the pitch either way.
    _meetup = (
        await db.execute(
            select(Meetup)
            .options(selectinload(Meetup.game_template))
            .where(Meetup.id == meetup_id)
        )
    ).scalar_one_or_none()
    was_draw = bool(
        is_tie
        and _meetup is not None
        and _meetup.game_template is not None
        and _meetup.game_template.allows_draws
    )

    # Complete current match — guarded UPDATE: under a double-tap / two
    # devices, exactly one request flips the row; the loser gets 409.
    now = datetime.now(UTC)
    res = await db.execute(
        update(MeetupMatch)
        .where(
            MeetupMatch.id == match.id,
            MeetupMatch.status != "completed",
        )
        .values(status="completed", completed_at=now, was_draw=was_draw)
    )
    if cast(CursorResult, res).rowcount != 1:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Match already completed.")
    match.status = "completed"
    match.completed_at = now
    await db.flush()

    winner_users: list[int] = _loads_int_list(
        match.team_a_users if winner_team == "a" else match.team_b_users
    )
    winner_name = match.team_a_name if winner_team == "a" else match.team_b_name

    # Auto-queue removed — the referee starts the next match manually.
    await refresh_skills_after_meetup(db, meetup_id)
    await db.commit()
    log_action(
        request,
        "match",
        "match.ended",
        f"Ended match #{match.match_number}: {match.score_a}-{match.score_b}, "
        f"{winner_name} wins"
        + (" (draw)" if is_tie else "")
        + "; referee will start the next match manually",
        meetup_id=meetup_id,
    )

    await _broadcast_match_event(
        meetup_id,
        {
            "type": "match_ended",
            "match_id": match.id,
            "match_number": match.match_number,
            "winner_team": winner_team,
            "winner_name": winner_name,
        },
    )

    await bump_and_notify(db, meetup_id)

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    result: dict = {
        "status": "completed",
        "match": _match_json(match, users_by_id),
        "winner_team": winner_team,
        "winner_name": winner_name,
        # A tied first match goes to a penalty shootout (referee UI shows it
        # automatically); the winner takes the de-facto win afterwards.
        "penalty_due": match.match_number == 1 and is_tie
        and match.penalty_winner is None,
    }
    result["all_matches_complete"] = True
    return result


# ── Steward lease + live goal log (live collaborative scoring) ─────


#: One-writer window for goal entry: 45 s, renewable, self-expiring.
LEASE_TTL_SECONDS = 45
#: Re-entering the same (team, scorer, minute) inside this window is a
#: duplicate: refused until the user confirms it with ``force``.
GOAL_DEDUPE_WINDOW_SECONDS = 90


def _seconds_left(expires_at: datetime, now: datetime) -> int:
    """Whole seconds left on a lease deadline (never negative)."""
    return max(int((expires_at - now).total_seconds()), 0)


async def _current_match(db: AsyncSession, meetup_id: int) -> MeetupMatch | None:
    """The meetup's current match: the highest-numbered one still open
    (pending / active / time_up), else the highest-numbered overall."""
    res = await db.execute(
        select(MeetupMatch)
        .where(MeetupMatch.meetup_id == meetup_id)
        .where(MeetupMatch.status.in_(("pending", "active", "time_up")))
        .order_by(MeetupMatch.match_number.desc())
        .limit(1)
    )
    match = res.scalar_one_or_none()
    if match is not None:
        return match
    res = await db.execute(
        select(MeetupMatch)
        .where(MeetupMatch.meetup_id == meetup_id)
        .order_by(MeetupMatch.match_number.desc())
        .limit(1)
    )
    return res.scalar_one_or_none()


async def _ensure_lease_row(db: AsyncSession, match_id: int, now: datetime) -> None:
    """Create the single lease row for a match if absent (idempotent).

    ``expires_at = now`` makes a fresh row immediately acquirable.
    """
    await db.execute(
        insert(MatchEditorLease)
        .prefix_with("OR IGNORE")
        .values(
            match_id=match_id,
            holder_id=None,
            acquired_at=now,
            expires_at=now,
            release_token="",
        )
    )


async def _lease_busy_response(
    db: AsyncSession, match_id: int, now: datetime
) -> JSONResponse:
    """409 naming whoever holds the lease and how long they have left.

    Never silent: the caller always learns whose turn it is.
    """
    holder_name, expires_in = "Someone", 0
    lease = await db.get(MatchEditorLease, match_id)
    if lease is not None and lease.holder_id is not None:
        holder = await db.get(User, lease.holder_id)
        holder_name = holder.display_name if holder else "Someone"
        expires_in = _seconds_left(lease.expires_at, now)
    return JSONResponse(
        status_code=409,
        content={"holder_name": holder_name, "expires_in": expires_in},
    )


async def _lease_match(
    db: AsyncSession, meetup_id: int, match_id: int | None
) -> MeetupMatch | None:
    """Resolve the lease's match: the explicit match_id when given (parallel
    matches each carry their own lease), else the meetup's current match."""
    if match_id is not None:
        m = await db.get(MeetupMatch, match_id)
        return m if m is not None and m.meetup_id == meetup_id else None
    return await _current_match(db, meetup_id)


@router.post("/{meetup_id}/matches/lease/acquire")
async def acquire_lease(
    meetup_id: int,
    match_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_present_member),
):
    """Claim the one-writer goal-entry lease.

    By default this is the current match's lease; pass ``match_id`` to scope
    it to a specific match (4-team / 2-pitch parallel play — each match has
    its own independent lease).

    Atomic: INSERT OR IGNORE the row, then a single guarded UPDATE
    (``holder_id IS NULL OR expires_at <= now``). ``rowcount == 0`` means
    somebody else holds it — they are named in the 409.
    """
    match = await _lease_match(db, meetup_id, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="No match in this meetup yet")

    now = utcnow()
    await _ensure_lease_row(db, match.id, now)
    token = secrets.token_urlsafe(24)
    res = await db.execute(
        update(MatchEditorLease)
        .where(MatchEditorLease.match_id == match.id)
        .where(
            or_(
                MatchEditorLease.holder_id.is_(None),
                MatchEditorLease.expires_at <= now,
                # Re-claim by the current holder (sheet double-open, page
                # remount): issue a fresh token instead of a 409 naming them.
                MatchEditorLease.holder_id == user.id,
            )
        )
        .values(
            holder_id=user.id,
            acquired_at=now,
            expires_at=now + timedelta(seconds=LEASE_TTL_SECONDS),
            release_token=token,
        )
    )
    await db.commit()

    if cast(CursorResult, res).rowcount != 1:
        return await _lease_busy_response(db, match.id, utcnow())

    await _broadcast_match_event(
        meetup_id,
        {
            "type": "lease_acquired",
            "match_id": match.id,
            "holder_name": user.display_name,
            "expires_in": LEASE_TTL_SECONDS,
        },
    )
    return {"lease_token": token, "expires_in": LEASE_TTL_SECONDS}


@router.post("/{meetup_id}/matches/lease/renew")
async def renew_lease(
    meetup_id: int,
    body: LeaseTokenBody,
    match_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_present_member),
):
    """Extend the lease by another 45 s — token checked, holder only.

    ``match_id`` scopes to a specific match (see acquire); the token is the
    primary gate, so a wrong match simply 409s.
    """
    match = await _lease_match(db, meetup_id, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="No match in this meetup yet")

    now = utcnow()
    res = await db.execute(
        update(MatchEditorLease)
        .where(MatchEditorLease.match_id == match.id)
        .where(
            MatchEditorLease.holder_id == user.id,
            MatchEditorLease.release_token == body.lease_token,
        )
        .values(expires_at=now + timedelta(seconds=LEASE_TTL_SECONDS))
    )
    await db.commit()

    if cast(CursorResult, res).rowcount != 1:
        # Token is not the live lease any more (taken over, or never ours).
        return await _lease_busy_response(db, match.id, utcnow())
    return {"lease_token": body.lease_token, "expires_in": LEASE_TTL_SECONDS}


@router.post("/{meetup_id}/matches/lease/release")
async def release_lease(
    meetup_id: int,
    body: LeaseTokenBody,
    match_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_present_member),
):
    """Give the lease up immediately — token checked, then broadcast.

    ``match_id`` scopes to a specific match (see acquire); the token is the
    primary gate, so a wrong match simply 409s.
    """
    match = await _lease_match(db, meetup_id, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="No match in this meetup yet")

    now = utcnow()
    res = await db.execute(
        update(MatchEditorLease)
        .where(MatchEditorLease.match_id == match.id)
        .where(
            MatchEditorLease.holder_id == user.id,
            MatchEditorLease.release_token == body.lease_token,
        )
        .values(holder_id=None, expires_at=now, release_token="")
    )
    await db.commit()

    if cast(CursorResult, res).rowcount != 1:
        return await _lease_busy_response(db, match.id, utcnow())

    await _broadcast_match_event(
        meetup_id,
        {"type": "lease_released", "match_id": match.id},
    )
    return {"released": True}


def _goal_json(goal: MatchGoal, users_by_id: dict[int, dict]) -> dict:
    """One goal row for the log (display names resolved, never bare ids)."""

    def person(uid: int | None) -> dict | None:
        if uid is None:
            return None
        entry = users_by_id.get(uid)
        name = entry["display_name"] if entry else f"User {uid}"
        return {
            "id": uid,
            "display_name": name,
            # Resolved here so any consumer (banner, log, history) can show a
            # profile pic without a second lookup.
            "avatar_url": (entry or {}).get("avatar_url"),
        }

    return {
        "id": goal.id,
        "team": goal.team,
        "clock_minute": goal.clock_minute,
        "clock_secs": goal.clock_secs,
        "scorer": person(goal.scorer_id),
        "assist": person(goal.assist_id),
        "goalkeeper": person(goal.goalkeeper_id),
        "recorded_by": person(goal.recorded_by),
        "after_whistle": bool(goal.after_whistle),
        "is_own_goal": bool(goal.is_own_goal),
    }


async def _goal_counts(db: AsyncSession, match: MeetupMatch) -> tuple[int, int]:
    """Live (non-soft-deleted) goal counts per team."""
    counts: dict[str, int] = {}
    for team in ("a", "b"):
        res = await db.execute(
            select(func.count())
            .select_from(MatchGoal)
            .where(
                MatchGoal.match_id == match.id,
                MatchGoal.team == team,
                MatchGoal.deleted_at.is_(None),
            )
        )
        counts[team] = int(res.scalar() or 0)
    return counts["a"], counts["b"]


async def _recompute_scores(db: AsyncSession, match: MeetupMatch) -> tuple[int, int]:
    """Derive score_a / score_b from COUNT of LIVE goals + manual offset.

    Goals are the source of truth; the referee's +1/-1/set-score corrections
    live in ``score_offset_*`` so both write paths compose.
    """
    count_a, count_b = await _goal_counts(db, match)
    match.score_a = count_a + (match.score_offset_a or 0)
    match.score_b = count_b + (match.score_offset_b or 0)
    return match.score_a, match.score_b


def _require_editable_goal_log(match: MeetupMatch) -> None:
    if match.penalty_winner is not None:
        raise HTTPException(
            status_code=409,
            detail="This match has a shootout result. Delete the match and record a new one to correct it.",
        )


async def _update_completed_draw(db: AsyncSession, match: MeetupMatch) -> None:
    match.was_draw = False
    if match.score_a == match.score_b:
        meetup = await db.scalar(
            select(Meetup).options(selectinload(Meetup.game_template)).where(Meetup.id == match.meetup_id)
        )
        match.was_draw = bool(meetup and meetup.game_template and meetup.game_template.allows_draws)


def _validate_goal_fields(body, match: MeetupMatch, users_by_id: dict[int, dict]) -> None:
    """Team/own-goal/keeper team-membership rules for one goal entry."""
    if body.scorer_id is not None and body.scorer_id not in users_by_id:
        raise HTTPException(status_code=400, detail="Scorer is not in this meetup")
    scoring = _loads_int_list(
        match.team_a_users if body.team == "a" else match.team_b_users
    )
    conceding = _loads_int_list(
        match.team_b_users if body.team == "a" else match.team_a_users
    )
    if body.is_own_goal and body.scorer_id is not None:
        if body.scorer_id not in conceding:
            raise HTTPException(
                status_code=400, detail="Own-goal scorer must be on the conceding team"
            )
    elif not body.is_own_goal and body.scorer_id is not None and body.scorer_id not in scoring:
        raise HTTPException(
            status_code=400, detail="Scorer must be on the scoring team"
        )
    if body.assist_id is not None:
        if body.assist_id not in users_by_id:
            raise HTTPException(status_code=400, detail="Assist is not in this meetup")
        if body.assist_id not in scoring:
            raise HTTPException(status_code=400, detail="Assist must be on the scoring team")
        if body.assist_id == body.scorer_id:
            raise HTTPException(
                status_code=400, detail="Assist must be a different player"
            )

    # The keeper field always means "the keeper who was beaten", so it must
    # be an *opposing* player. Enforced server-side, not just in the picker,
    # so a stale client cannot file a striker under 'goalkeeper'.
    if body.goalkeeper_id is not None:
        if body.goalkeeper_id not in users_by_id:
            raise HTTPException(
                status_code=400, detail="Goalkeeper is not in this meetup"
            )
        if body.goalkeeper_id == body.scorer_id:
            raise HTTPException(
                status_code=400,
                detail="Goalkeeper must be on the conceding team, not the scorer",
            )
        if body.assist_id is not None and body.goalkeeper_id == body.assist_id:
            raise HTTPException(
                status_code=400,
                detail="Goalkeeper must be on the conceding team, not the assist",
            )
        if body.goalkeeper_id not in set(conceding):
            raise HTTPException(
                status_code=400,
                detail="Goalkeeper must be on the conceding team",
            )


@router.post("/{meetup_id}/matches/{match_id}/goals", status_code=201)
async def create_goal(
    meetup_id: int,
    match_id: int,
    body: GoalCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_present_member),
):
    """Log one goal (caller must hold the live lease; idempotent via intent).

    On success: recompute ``score_a``/``score_b`` from COUNT, release the
    lease (the next person's turn starts clean) and broadcast ``goal_added``.
    """
    await db.execute(text("BEGIN IMMEDIATE"))
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    _require_editable_goal_log(match)

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    _validate_goal_fields(body, match, users_by_id)

    # Network retry with the same intent replays the row already stored.
    res = await db.execute(
        select(MatchGoal).where(MatchGoal.intent_id == body.intent_id)
    )
    replayed = res.scalar_one_or_none()
    if replayed is not None:
        score_a, score_b = await _recompute_scores(db, match)
        await db.commit()
        # Idempotent replay: 200 (not 201) — nothing new was created.
        return JSONResponse(
            status_code=200,
            content={
                "goal": _goal_json(replayed, users_by_id),
                "replayed": True,
                "score_a": score_a,
                "score_b": score_b,
            },
        )

    # Lease gate: whose turn it is, named (never silent).
    lease = await db.get(MatchEditorLease, match_id)
    now = utcnow()
    if lease is None or lease.holder_id is None or lease.expires_at <= now:
        return await _lease_busy_response(db, match_id, now)
    if lease.holder_id != user.id:
        return await _lease_busy_response(db, match_id, now)

    # Use the confirmed minute when supplied. Older clients use the live clock.
    remaining = _compute_timer_remaining(match)
    elapsed = max((match.timer_total_seconds or 0) - remaining, 0)
    live_minute = elapsed // 60 + 1
    clock_minute = body.clock_minute if body.clock_minute is not None else live_minute
    after_whistle = (
        remaining <= 0
        or match.status in ("time_up", "completed")
        or clock_minute * 60 > match.timer_total_seconds
    )

    # Duplicate backstop: the same (team, scorer, minute) inside 90 s.
    res = await db.execute(
        select(MatchGoal).where(
            MatchGoal.match_id == match_id,
            MatchGoal.team == body.team,
            MatchGoal.clock_minute == clock_minute,
            MatchGoal.scorer_id == body.scorer_id,
            MatchGoal.deleted_at.is_(None),
        )
        .order_by(MatchGoal.created_at.desc(), MatchGoal.id.desc())
        .limit(1)
    )
    duplicate = res.scalar_one_or_none()
    if duplicate is not None and not body.force:
        age = int((utcnow() - duplicate.created_at).total_seconds())
        if age <= GOAL_DEDUPE_WINDOW_SECONDS:
            await db.commit()
            return JSONResponse(
                status_code=409,
                content={
                    "detail": "duplicate_goal_within_90s",
                    "existing": _goal_json(duplicate, users_by_id),
                    "holder_name": user.display_name,
                    "expires_in": _seconds_left(lease.expires_at, utcnow()),
                },
            )
        # Duplicate confirmed after the 90 s window: the row already exists —
        # replay it. 200, not 201.
        await db.commit()
        return JSONResponse(
            status_code=200,
            content={
                "goal": _goal_json(duplicate, users_by_id),
                "replayed": True,
                "score_a": match.score_a,
                "score_b": match.score_b,
            },
        )
    # ``force`` with a live duplicate means a genuine second goal in the same
    # minute: a fresh row is inserted below (no hard index blocks it).

    goal = MatchGoal(
        match_id=match_id,
        team=body.team,
        scorer_id=body.scorer_id,
        assist_id=body.assist_id,
        goalkeeper_id=body.goalkeeper_id,
        clock_secs=remaining if clock_minute == live_minute else max(
            match.timer_total_seconds - (clock_minute - 1) * 60, 0
        ),
        clock_minute=clock_minute,
        after_whistle=after_whistle,
        is_own_goal=body.is_own_goal,
        recorded_by=user.id,
        intent_id=body.intent_id,
    )
    db.add(goal)
    await db.flush()
    score_a, score_b = await _recompute_scores(db, match)
    # Our turn ends with the goal logged: release the lease in the same tx.
    lease.holder_id = None
    lease.expires_at = utcnow()
    lease.release_token = ""
    if match.status == "completed":
        await _update_completed_draw(db, match)
        await refresh_skills_after_meetup(db, meetup_id)
    await db.commit()
    scorer_name = users_by_id.get(body.scorer_id, {}).get("display_name", "Unknown scorer")
    log_action(
        request,
        "referee",
        "referee.goal_added",
        f"Goal in match #{match.match_number}: {scorer_name} "
        f"({match.team_a_name if body.team == 'a' else match.team_b_name}) "
        f"at {clock_minute}{'+' if after_whistle else ''} → {score_a}-{score_b}",
        meetup_id=meetup_id,
    )

    await _broadcast_match_event(
        meetup_id,
        {
            "type": "goal_added",
            "match_id": match_id,
            "goal": _goal_json(goal, users_by_id),
            "score_a": score_a,
            "score_b": score_b,
        },
    )
    # The turn ended: clear lease chips on every client immediately.
    await _broadcast_match_event(
        meetup_id, {"type": "lease_released", "match_id": match_id}
    )
    await bump_and_notify(db, meetup_id)

    return {
        "goal": _goal_json(goal, users_by_id),
        "replayed": False,
        "score_a": score_a,
        "score_b": score_b,
    }


async def _historical_goal_rosters(
    db: AsyncSession, match: MeetupMatch, users_by_id: dict[int, dict]
) -> dict[str, list[dict]]:
    team_ids = {
        "a": set(_loads_int_list(match.team_a_users)),
        "b": set(_loads_int_list(match.team_b_users)),
    }
    subs = await db.scalars(
        select(MatchSubstitution).where(
            MatchSubstitution.match_id == match.id,
            MatchSubstitution.clock_secs.is_not(None),
        )
    )
    for sub in subs:
        team_ids["a"].update(_loads_int_list(sub.old_team_a_users))
        team_ids["a"].update(_loads_int_list(sub.new_team_a_users))
        team_ids["b"].update(_loads_int_list(sub.old_team_b_users))
        team_ids["b"].update(_loads_int_list(sub.new_team_b_users))

    if not all(team_ids.values()):
        confirmed = set(await db.scalars(
            select(Attendance.user_id).where(
                Attendance.meetup_id == match.meetup_id,
                Attendance.status == "confirmed",
            )
        ))
        # Score-only matches entered by hand may not have stored lineups.
        team_ids = {
            "a": team_ids["a"] or confirmed - team_ids["b"],
            "b": team_ids["b"] or confirmed - team_ids["a"],
        }

    return {
        side: sorted(
            (users_by_id[uid] for uid in ids if uid in users_by_id),
            key=lambda user: (user["display_name"].casefold(), user["id"]),
        )
        for side, ids in team_ids.items()
    }


@router.get("/{meetup_id}/matches/{match_id}/goals")
async def list_goals(
    meetup_id: int,
    match_id: int,
    request: Request,
    include_history_rosters: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Live goal log for one match (authenticated, ordered by minute)."""
    if include_history_rosters:
        require_admin(request)
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    res = await db.execute(
        select(MatchGoal)
        .where(MatchGoal.match_id == match_id, MatchGoal.deleted_at.is_(None))
        .order_by(MatchGoal.clock_minute, MatchGoal.id)
    )
    goals = list(res.scalars().all())
    users_by_id = await _load_users_for_meetup(db, meetup_id)
    result = {
        "goals": [_goal_json(g, users_by_id) for g in goals],
        "score_a": match.score_a,
        "score_b": match.score_b,
    }
    if include_history_rosters:
        result["rosters"] = await _historical_goal_rosters(db, match, users_by_id)
    return result


@router.put("/{meetup_id}/matches/{match_id}/goal-attribution")
async def save_historical_goal(
    meetup_id: int,
    match_id: int,
    body: HistoricalGoalAttribution,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Attribute an existing goal or add a missed goal to a completed match."""
    await db.execute(text("BEGIN IMMEDIATE"))
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    _require_editable_goal_log(match)
    if match.status != "completed":
        raise HTTPException(status_code=409, detail="Only completed matches can be edited here")

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    goal = None
    if body.goal_id is not None:
        if body.add_to_score:
            raise HTTPException(status_code=400, detail="An existing goal already counts toward the score.")
        goal = await db.get(MatchGoal, body.goal_id)
        if goal is None or goal.match_id != match_id or goal.deleted_at:
            raise HTTPException(status_code=404, detail="Goal not found")
        if goal.team != body.team:
            raise HTTPException(status_code=400, detail="The scoring team is fixed for this goal")
    else:
        replayed = await db.scalar(select(MatchGoal).where(MatchGoal.intent_id == body.intent_id))
        if replayed:
            if replayed.match_id != match_id or replayed.team != body.team or replayed.deleted_at:
                raise HTTPException(status_code=409, detail="This goal entry is no longer available")
            return {
                "goal": _goal_json(replayed, users_by_id),
                "score_a": match.score_a, "score_b": match.score_b, "was_draw": match.was_draw,
            }

    lease = await db.get(MatchEditorLease, match.id)
    if lease and lease.holder_id is not None and lease.expires_at > utcnow():
        raise HTTPException(status_code=409, detail="A referee is editing goals for this match. Try again shortly.")

    rosters = await _historical_goal_rosters(db, match, users_by_id)
    scoring = {p["id"] for p in rosters[body.team]}
    conceding = {p["id"] for p in rosters["b" if body.team == "a" else "a"]}
    scorer_team = conceding if body.is_own_goal else scoring
    if body.scorer_id is not None and body.scorer_id not in scorer_team:
        raise HTTPException(status_code=400, detail="Select a scorer from the correct team")
    if body.assist_id is not None and (
        body.assist_id == body.scorer_id
        or body.assist_id not in scoring
    ):
        raise HTTPException(status_code=400, detail="Select a different player from the scoring team as the assist")
    if body.goalkeeper_id is not None and (
        body.goalkeeper_id in (body.scorer_id, body.assist_id)
        or body.goalkeeper_id not in conceding
    ):
        raise HTTPException(status_code=400, detail="Select a different player from the conceding team as the keeper")

    if goal is None:
        count_a, count_b = await _goal_counts(db, match)
        count, score = (count_a, match.score_a) if body.team == "a" else (count_b, match.score_b)
        if body.add_to_score:
            has_shootout = (
                match.penalty_score_a is not None
                or match.penalty_score_b is not None
                or await db.scalar(select(MatchPenalty.id).where(MatchPenalty.match_id == match.id).limit(1)) is not None
            )
            if has_shootout:
                raise HTTPException(
                    status_code=409, detail="This match has a recorded shootout. You can still assign scorers to its existing goals."
                )
            match.score_a += int(body.team == "a")
            match.score_b += int(body.team == "b")
            await _update_completed_draw(db, match)
        elif count >= score:
            raise HTTPException(status_code=409, detail="Every goal for this team already has a goal entry.")
        goal = MatchGoal(
            match_id=match_id,
            team=body.team,
            recorded_by=user.id,
            intent_id=body.intent_id,
            clock_minute=0,
            clock_secs=0,
        )
        db.add(goal)
        # Keep any other unattributed goals in the score, including legacy manual scores.
        match.score_offset_a = match.score_a - count_a - int(body.team == "a")
        match.score_offset_b = match.score_b - count_b - int(body.team == "b")

    goal.scorer_id = body.scorer_id
    goal.assist_id = body.assist_id
    goal.goalkeeper_id = body.goalkeeper_id
    goal.is_own_goal = body.is_own_goal
    await refresh_skills_after_meetup(db, meetup_id)
    revision = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    log_action(
        request,
        "match",
        "match.goal_added" if body.add_to_score else "match.goal_attributed",
        f"Added a goal to match #{match.match_number}" if body.add_to_score
        else f"Updated goal details in match #{match.match_number}",
        meetup_id=meetup_id,
    )
    if revision is not None:
        await notify_meetup_data_changed(meetup_id, revision)
    return {
        "goal": _goal_json(goal, users_by_id),
        "score_a": match.score_a, "score_b": match.score_b, "was_draw": match.was_draw,
    }


@router.patch("/{meetup_id}/matches/{match_id}/goals/{goal_id}")
async def update_goal(
    meetup_id: int,
    match_id: int,
    goal_id: int,
    body: GoalUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_present_member),
):
    """Edit a logged goal (caller must hold the live lease, like create)."""
    await db.execute(text("BEGIN IMMEDIATE"))
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    _require_editable_goal_log(match)
    res = await db.execute(
        select(MatchGoal).where(
            MatchGoal.id == goal_id,
            MatchGoal.match_id == match_id,
            MatchGoal.deleted_at.is_(None),
        )
    )
    goal = res.scalar_one_or_none()
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    _validate_goal_fields(body, match, users_by_id)

    # Same one-writer gate as create: only the lease holder may edit.
    lease = await db.get(MatchEditorLease, match.id)
    now = utcnow()
    if lease is None or lease.holder_id is None or lease.expires_at <= now:
        return await _lease_busy_response(db, match.id, now)
    if lease.holder_id != user.id:
        return await _lease_busy_response(db, match.id, now)

    goal.team = body.team
    goal.scorer_id = body.scorer_id
    goal.assist_id = body.assist_id
    goal.goalkeeper_id = body.goalkeeper_id
    goal.is_own_goal = body.is_own_goal
    goal.clock_minute = body.clock_minute
    goal.clock_secs = max(
        (match.timer_total_seconds or 0) - (body.clock_minute - 1) * 60, 0
    )
    goal.after_whistle = body.clock_minute * 60 > (match.timer_total_seconds or 0)
    await db.flush()
    score_a, score_b = await _recompute_scores(db, match)
    # Editing ends our turn: release the lease in the same tx.
    lease.holder_id = None
    lease.expires_at = utcnow()
    lease.release_token = ""
    if match.status == "completed":
        await _update_completed_draw(db, match)
        await refresh_skills_after_meetup(db, meetup_id)
    await db.commit()
    scorer_name = users_by_id.get(goal.scorer_id, {}).get("display_name", "Unknown scorer")
    log_action(
        request,
        "referee",
        "referee.goal_edited",
        f"Edited goal in match #{match.match_number}: now {scorer_name} "
        f"at {goal.clock_minute}' → {score_a}-{score_b}",
        meetup_id=meetup_id,
    )

    await _broadcast_match_event(
        meetup_id,
        {
            "type": "goal_updated",
            "match_id": match_id,
            "goal": _goal_json(goal, users_by_id),
            "score_a": score_a,
            "score_b": score_b,
        },
    )
    # The turn ended: clear lease chips on every client immediately.
    await _broadcast_match_event(
        meetup_id, {"type": "lease_released", "match_id": match_id}
    )
    await bump_and_notify(db, meetup_id)

    return {
        "goal": _goal_json(goal, users_by_id),
        "score_a": score_a,
        "score_b": score_b,
    }


@router.delete("/{meetup_id}/matches/{match_id}/goals/{goal_id}", status_code=204)
async def remove_goal(
    meetup_id: int,
    match_id: int,
    goal_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_present_member),
):
    """Soft-delete one goal, recompute counters, broadcast ``goal_removed``."""
    await db.execute(text("BEGIN IMMEDIATE"))
    res = await db.execute(
        select(MatchGoal).where(
            MatchGoal.id == goal_id,
            MatchGoal.match_id == match_id,
            MatchGoal.deleted_at.is_(None),
        )
    )
    goal = res.scalar_one_or_none()
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    _require_editable_goal_log(match)

    goal.deleted_at = utcnow()
    await db.flush()
    score_a, score_b = await _recompute_scores(db, match)
    if match.status == "completed":
        await _update_completed_draw(db, match)
        await refresh_skills_after_meetup(db, meetup_id)
    await db.commit()
    log_action(
        request,
        "referee",
        "referee.goal_removed",
        f"Removed goal in match #{match.match_number} ({goal.clock_minute}') → "
        f"{score_a}-{score_b}",
        meetup_id=meetup_id,
    )

    await _broadcast_match_event(
        meetup_id,
        {
            "type": "goal_removed",
            "match_id": match_id,
            "goal_id": goal_id,
            "removed_by": user.display_name,
            "score_a": score_a,
            "score_b": score_b,
        },
    )
    await bump_and_notify(db, meetup_id)
    return None


@router.get("/{meetup_id}/steward-state")
async def steward_state(
    meetup_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Steward gate + current lease, fetched once to decide what to render.

    Answers 200 with the *reason* rather than 403, so the UI can explain
    itself (``not_attending`` vs ``outside_window``) without an error toast.
    """
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    ok, reason = await presence_for_meetup(db, meetup_id, user)

    lease = None
    match = await _current_match(db, meetup_id)
    if match is not None:
        row = await db.get(MatchEditorLease, match.id)
        if row is not None and row.holder_id is not None:
            left = _seconds_left(row.expires_at, utcnow())
            if left > 0:
                holder = await db.get(User, row.holder_id)
                lease = {
                    "holder_name": holder.display_name if holder else "Someone",
                    "expires_in": left,
                }
    return {
        "can_control": ok,
        "reason": reason,
        "lease": lease,
        "match_id": match.id if match is not None else None,
    }
