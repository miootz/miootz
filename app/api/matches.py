"""Live match management: start matches, timer, scores, end matches."""

from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timedelta, UTC

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, insert, or_, select, text, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession
from typing import cast

from app.api.deps import (
    presence_for_meetup,
    require_admin,
    require_present_member,
)
from app.core.database import get_db
from app.core.json_column import loads_int_list as _loads_int_list
from app.core.meetup_data_manager import meetup_data_manager
from app.core.timeutil import utcnow
from app.models.match import MeetupMatch, MatchSubstitution
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
from app.services.meetup_revision import bump_and_notify

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meetups", tags=["matches"])


# ── Pydantic schemas ──────────────────────────────────────────────


class MatchTeamSwap(BaseModel):
    team_a_users: list[int] = Field(min_length=1)
    team_b_users: list[int] = Field(min_length=1)


class MatchEndBody(BaseModel):
    #: Required only when scores are tied. "a" or "b".
    winner_team: str | None = None


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


class MatchScoreSet(BaseModel):
    score_a: int = Field(ge=0)
    score_b: int = Field(ge=0)


class LeaseTokenBody(BaseModel):
    #: Token handed out by ``lease/acquire``; must be echoed to renew/release.
    lease_token: str = Field(min_length=1)


class GoalCreate(BaseModel):
    team: str = Field(pattern=r"^[ab]$")
    scorer_id: int
    assist_id: int | None = None
    #: Keeper who was in goal for the *conceding* team (must be an opposing
    #: player). Optional — nobody should be blocked on an unknown/rotated keeper.
    goalkeeper_id: int | None = None
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
    scorer_id: int
    assist_id: int | None = None
    goalkeeper_id: int | None = None
    clock_minute: int = Field(ge=1, le=600)
    is_own_goal: bool = False


# ── Helpers ───────────────────────────────────────────────────────


def _compute_timer_remaining(match: MeetupMatch) -> int:
    """Compute server-authoritative remaining seconds."""
    if match.timer_started_at is None:
        return match.timer_total_seconds
    if match.status in ("completed",):
        return 0

    started = match.timer_started_at.replace(tzinfo=UTC)
    now = datetime.now(UTC)
    elapsed = (now - started).total_seconds()

    # Subtract pause intervals
    pause_intervals: list[dict] = []
    if match.timer_pause_intervals:
        try:
            pause_intervals = json.loads(match.timer_pause_intervals)
        except json.JSONDecodeError, TypeError:
            pass

    for interval in pause_intervals:
        paused_at = interval.get("paused_at")
        resumed_at = interval.get("resumed_at")
        if paused_at:
            pa = datetime.fromisoformat(paused_at).replace(tzinfo=UTC)
            if resumed_at:
                ra = datetime.fromisoformat(resumed_at).replace(tzinfo=UTC)
                elapsed -= (ra - pa).total_seconds()
            else:
                # Currently paused — pause until now
                elapsed -= (now - pa).total_seconds()

    try:
        remaining = int(match.timer_total_seconds or 0) - int(elapsed)
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
    if match.status != "active":
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
    body: StartMatchesBody | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Start the match meetup. Creates the first match (Team 1 vs Team 2 by default,
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
    players = [
        {
            "id": str(u.id),
            "name": u.display_name,
            "skill": (u.calculated_skill or u.self_assessed_skill or 3),
            "user_id": u.id,
            "avatar_url": u.avatar_url,
            "primary_specialty": u.primary_specialty,
            "secondary_specialty": u.secondary_specialty,
            "calculated_skill": u.calculated_skill,
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
    )
    if len(teams_nested) < 2:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least 2 teams to start matches. Found {len(teams_nested)}.",
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

    team_a = teams_nested[team_a_idx]
    team_b = teams_nested[team_b_idx]

    match_duration = meetup.match_duration_minutes or 10

    match = MeetupMatch(
        meetup_id=meetup_id,
        match_number=1,
        team_a_users=json.dumps([p["user_id"] for p in team_a]),
        team_b_users=json.dumps([p["user_id"] for p in team_b]),
        team_a_name=team_names[team_a_idx] if team_names else "Team 1",
        team_b_name=(
            team_names[team_b_idx]
            if team_names and len(team_names) > team_b_idx
            else "Team 2"
        ),
        score_a=0,
        score_b=0,
        status="pending",
        timer_total_seconds=match_duration * 60,
        timer_seconds_remaining=None,
    )
    db.add(match)
    await db.commit()
    await db.refresh(match)

    # Notify
    await bump_and_notify(db, meetup_id)
    await _broadcast_match_event(
        meetup_id,
        {
            "type": "match_created",
            "match_id": match.id,
            "match_number": 1,
        },
    )

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return {"status": "started", "match": _match_json(match, users_by_id)}


@router.post("/{meetup_id}/matches/new", status_code=201)
async def create_new_pending_match(
    meetup_id: int,
    body: CreatePendingMatchBody | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
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
    players = [
        {
            "id": str(u.id),
            "name": u.display_name,
            "skill": (u.calculated_skill or u.self_assessed_skill or 3),
            "user_id": u.id,
            "avatar_url": u.avatar_url,
            "primary_specialty": u.primary_specialty,
            "secondary_specialty": u.secondary_specialty,
            "calculated_skill": u.calculated_skill,
        }
        for u in confirmed_users
    ]

    mode = getattr(meetup, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_meetup_teams_nested(
        getattr(meetup, "manual_teams_json", None),
        mode,
        players,
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
        team_a = teams_nested[body.team_a_idx]
        team_b = teams_nested[body.team_b_idx]
        team_a_name = (
            team_names[body.team_a_idx]
            if team_names and body.team_a_idx < len(team_names)
            else f"Team {body.team_a_idx + 1}"
        )
        team_b_name = (
            team_names[body.team_b_idx]
            if team_names and body.team_b_idx < len(team_names)
            else f"Team {body.team_b_idx + 1}"
        )
        team_a_users_list = [p["user_id"] for p in team_a]
        team_b_users_list = [p["user_id"] for p in team_b]
    else:
        # Auto-pick: last match winner vs next available team
        winner_users: list[int] = _loads_int_list(
            last_match.team_a_users
            if last_match.score_a > last_match.score_b
            else last_match.team_b_users
        )
        winner_name = (
            last_match.team_a_name
            if last_match.score_a > last_match.score_b
            else last_match.team_b_name
        )

        # Find which teams have already entered
        all_matches = await db.execute(
            select(MeetupMatch)
            .where(MeetupMatch.meetup_id == meetup_id)
            .order_by(MeetupMatch.match_number.asc())
        )
        played_matches = all_matches.scalars().all()

        used_team_indices: set[int] = set()
        for m in played_matches:
            ma_users = set(_loads_int_list(m.team_a_users))
            mb_users = set(_loads_int_list(m.team_b_users))
            for idx, team in enumerate(teams_nested):
                team_user_ids = set(p["user_id"] for p in team)
                if team_user_ids == ma_users or team_user_ids == mb_users:
                    used_team_indices.add(idx)

        import random as _random

        unplayed_indices = [
            idx for idx in range(len(teams_nested)) if idx not in used_team_indices
        ]
        if unplayed_indices:
            next_team_idx = unplayed_indices[0]
        else:
            available = [
                idx
                for idx in range(len(teams_nested))
                if set(p["user_id"] for p in teams_nested[idx]) != set(winner_users)
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
            else f"Team {next_team_idx + 1}"
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

    await bump_and_notify(db, meetup_id)

    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return {"status": "created", "match": _match_json(new_match, users_by_id)}


@router.delete("/{meetup_id}/matches/{match_id}", status_code=204)
async def delete_match(
    meetup_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Delete a match (admin only)."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    from app.services.deletes import delete_match_children

    await delete_match_children(db, match_id)
    await db.delete(match)
    await db.commit()
    await bump_and_notify(db, meetup_id)


@router.post("/{meetup_id}/matches/create", status_code=201)
async def create_match(
    meetup_id: int,
    body: MatchCreateBody,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
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

    match = MeetupMatch(
        meetup_id=meetup_id,
        match_number=next_num,
        team_a_users=json.dumps([]),
        team_b_users=json.dumps([]),
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

    await bump_and_notify(db, meetup_id)

    users_by_id: dict[int, dict] = {}
    return {"status": "created", "match": _match_json(match, users_by_id)}


@router.patch("/{meetup_id}/matches/{match_id}/teams")
async def swap_match_teams(
    meetup_id: int,
    match_id: int,
    body: MatchTeamSwap,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Substitute players between teams before the match starts (admin).

    Records a before/after snapshot in match_substitutions (for rankings)
    and persists the new partition to meetup.manual_teams_json so future
    rounds inherit it.
    """
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot swap teams for a {match.status} match.",
        )

    old_a = _loads_int_list(match.team_a_users)
    old_b = _loads_int_list(match.team_b_users)
    new_a, new_b = list(body.team_a_users), list(body.team_b_users)
    # 1-for-1 between ANY two rosters (including the meetup's non-playing
    # teams): each match team keeps its size, players may not duplicate,
    # and every substitute must be a confirmed attendee.
    if len(new_a) != len(old_a) or len(new_b) != len(old_b) or (
        len(set(new_a)) != len(new_a) or len(set(new_b)) != len(new_b)
    ):
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

    db.add(
        MatchSubstitution(
            meetup_id=meetup_id,
            match_id=match.id,
            old_team_a_users=json.dumps(old_a),
            old_team_b_users=json.dumps(old_b),
            new_team_a_users=json.dumps(new_a),
            new_team_b_users=json.dumps(new_b),
            recorded_by=_user.id,
        )
    )
    match.team_a_users = json.dumps(new_a)
    match.team_b_users = json.dumps(new_b)

    # Propagate the swap to the meetup-level partition (future rounds).
    meetup = await db.get(Meetup, meetup_id)
    result = await db.execute(
        select(User)
        .join(Attendance, Attendance.user_id == User.id)
        .where(
            Attendance.meetup_id == meetup_id,
            Attendance.status == "confirmed",
        )
    )
    confirmed_users = result.scalars().all()
    players = [
        {
            "id": str(u.id),
            "name": u.display_name,
            "skill": (u.calculated_skill or u.self_assessed_skill or 3),
            "user_id": u.id,
            "avatar_url": u.avatar_url,
            "primary_specialty": u.primary_specialty,
            "secondary_specialty": u.secondary_specialty,
            "calculated_skill": u.calculated_skill,
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
    )

    await bump_and_notify(db, meetup_id)
    users_by_id = await _load_users_for_meetup(db, meetup_id)
    return _match_json(match, users_by_id)


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
    return {
        "substitutions": [
            {
                "id": s.id,
                "recorded_by": by_id[s.recorded_by].display_name
                if by_id[s.recorded_by]
                else None,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "old_team_a_users": _loads_int_list(s.old_team_a_users),
                "old_team_b_users": _loads_int_list(s.old_team_b_users),
                "new_team_a_users": _loads_int_list(s.new_team_a_users),
                "new_team_b_users": _loads_int_list(s.new_team_b_users),
            }
            for s in rows
        ]
    }


@router.post("/{meetup_id}/matches/{match_id}/timer/start")
async def start_timer(
    meetup_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_present_member),
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
            detail="Time is up — only an admin can open extra time.",
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

    match.timer_started_at = datetime.now(UTC)
    match.timer_seconds_remaining = match.timer_total_seconds
    match.timer_pause_intervals = "[]"
    match.status = "active"
    await db.commit()

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
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_present_member),
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


@router.post("/{meetup_id}/matches/{match_id}/timer/resume")
async def resume_timer(
    meetup_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_present_member),
):
    """Resume the match timer (any present member, idempotent)."""
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
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_present_member),
):
    """Reset timer and scores for a match (present member, idempotent)."""
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
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
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
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Set scores directly (bulk correction)."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    count_a, count_b = await _goal_counts(db, match)
    match.score_a = body.score_a
    match.score_b = body.score_b
    match.score_offset_a = body.score_a - count_a
    match.score_offset_b = body.score_b - count_b
    await db.commit()

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
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """End the current match. Winner stays on pitch; next team enters."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status in ("completed",):
        raise HTTPException(status_code=409, detail="Match already completed.")

    # Determine winner
    if match.score_a > match.score_b:
        winner_team = "a"
    elif match.score_b > match.score_a:
        winner_team = "b"
    else:
        # Tie — require admin to pick
        if not body.winner_team:
            raise HTTPException(
                status_code=400,
                detail="Scores are tied. Specify winner_team: 'a' or 'b'.",
            )
        winner_team = body.winner_team

    # Complete current match — guarded UPDATE: under a double-tap / two
    # devices, exactly one request flips the row; the loser gets 409.
    now = datetime.now(UTC)
    res = await db.execute(
        update(MeetupMatch)
        .where(
            MeetupMatch.id == match.id,
            MeetupMatch.status != "completed",
        )
        .values(status="completed", completed_at=now)
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

    # Get all teams for this meetup to find next team
    _meetup = await db.get(Meetup, meetup_id)
    _result = await db.execute(
        select(User)
        .join(Attendance, Attendance.user_id == User.id)
        .where(
            Attendance.meetup_id == meetup_id,
            Attendance.status == "confirmed",
        )
    )
    _players = [
        {
            "id": str(u.id),
            "name": u.display_name,
            "skill": (u.calculated_skill or u.self_assessed_skill or 3),
            "user_id": u.id,
        }
        for u in _result.scalars().all()
    ]
    _mode = getattr(_meetup, "team_assignment_mode", None) or "balanced"
    teams = resolve_meetup_teams_nested(
        getattr(_meetup, "manual_teams_json", None),
        _mode,
        _players,
    )
    team_names = get_team_names(_meetup)

    # Find which teams have already been used as the "entering" side
    all_matches = await db.execute(
        select(MeetupMatch)
        .where(MeetupMatch.meetup_id == meetup_id)
        .where(MeetupMatch.match_number <= match.match_number)
        .order_by(MeetupMatch.match_number.asc())
    )
    played_matches = all_matches.scalars().all()

    # Track which team indices have entered
    used_team_indices: set[int] = set()
    for m in played_matches:
        ma_users = set(_loads_int_list(m.team_a_users))
        mb_users = set(_loads_int_list(m.team_b_users))
        for idx, team in enumerate(teams):
            team_user_ids = set(p["user_id"] for p in team)
            if team_user_ids == ma_users or team_user_ids == mb_users:
                used_team_indices.add(idx)

    # Find next unplayed team
    next_team = None
    next_team_idx = None
    for idx, team in enumerate(teams):
        if idx not in used_team_indices:
            next_team = team
            next_team_idx = idx
            break

    next_match_data: dict | None = None
    if next_team is not None and next_team_idx is not None:
        used_team_indices.add(next_team_idx)
        next_team_name = (
            team_names[next_team_idx]
            if team_names and next_team_idx < len(team_names)
            else f"Team {next_team_idx + 1}"
        )
        next_match = MeetupMatch(
            meetup_id=meetup_id,
            match_number=match.match_number + 1,
            team_a_users=json.dumps(winner_users),
            team_b_users=json.dumps([p["user_id"] for p in next_team]),
            team_a_name=winner_name,
            team_b_name=next_team_name,
            score_a=0,
            score_b=0,
            status="pending",
            # The meetup's configured duration, NOT the ended match's:
            # retroactive matches carry timer_total_seconds=0 and would
            # poison every following match.
            timer_total_seconds=(_meetup.match_duration_minutes or 10) * 60,
        )
        db.add(next_match)
        await db.flush()
        users_by_id = await _load_users_for_meetup(db, meetup_id)
        next_match_data = _match_json(next_match, users_by_id)

    await db.commit()

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
    }
    if next_match_data:
        result["next_match"] = next_match_data
    else:
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
    user: User = Depends(require_present_member),
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
    user: User = Depends(require_present_member),
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
    user: User = Depends(require_present_member),
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


def _validate_goal_fields(body, match: MeetupMatch, users_by_id: dict[int, dict]) -> None:
    """Team/own-goal/keeper team-membership rules for one goal entry."""
    if body.scorer_id not in users_by_id:
        raise HTTPException(status_code=400, detail="Scorer is not in this meetup")
    scoring = _loads_int_list(
        match.team_a_users if body.team == "a" else match.team_b_users
    )
    conceding = _loads_int_list(
        match.team_b_users if body.team == "a" else match.team_a_users
    )
    if body.is_own_goal:
        if body.scorer_id not in conceding:
            raise HTTPException(
                status_code=400, detail="Own-goal scorer must be on the conceding team"
            )
    elif body.scorer_id not in scoring:
        raise HTTPException(
            status_code=400, detail="Scorer must be on the scoring team"
        )
    if body.assist_id is not None:
        if body.assist_id not in users_by_id:
            raise HTTPException(status_code=400, detail="Assist is not in this meetup")
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
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_present_member),
):
    """Log one goal (caller must hold the live lease; idempotent via intent).

    On success: recompute ``score_a``/``score_b`` from COUNT, release the
    lease (the next person's turn starts clean) and broadcast ``goal_added``.
    """
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")

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

    # Timer clock is authoritative for the minute mark.
    remaining = _compute_timer_remaining(match)
    elapsed = max((match.timer_total_seconds or 0) - remaining, 0)
    clock_minute = elapsed // 60 + 1
    after_whistle = remaining <= 0 or match.status in ("time_up", "completed")

    # Duplicate backstop: the same (team, scorer, minute) inside 90 s.
    res = await db.execute(
        select(MatchGoal).where(
            MatchGoal.match_id == match_id,
            MatchGoal.team == body.team,
            MatchGoal.clock_minute == clock_minute,
            MatchGoal.scorer_id == body.scorer_id,
            MatchGoal.deleted_at.is_(None),
        )
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
        clock_secs=remaining,
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
    await db.commit()

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


@router.get("/{meetup_id}/matches/{match_id}/goals")
async def list_goals(
    meetup_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Live goal log for one match (public, ordered by minute)."""
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
    return {
        "goals": [_goal_json(g, users_by_id) for g in goals],
        "score_a": match.score_a,
        "score_b": match.score_b,
    }


@router.patch("/{meetup_id}/matches/{match_id}/goals/{goal_id}")
async def update_goal(
    meetup_id: int,
    match_id: int,
    goal_id: int,
    body: GoalUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_present_member),
):
    """Edit a logged goal (caller must hold the live lease, like create)."""
    match = await db.get(MeetupMatch, match_id)
    if not match or match.meetup_id != meetup_id:
        raise HTTPException(status_code=404, detail="Match not found")
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
    await db.commit()

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


async def _require_goal_deleter(
    request: Request, db: AsyncSession = Depends(get_db)
) -> User:
    """Any present member while the presence window is open; admin only after."""
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if getattr(request.state, "is_admin", False):
        return user
    ok, reason = await presence_for_meetup(
        db, int(request.path_params["meetup_id"]), user
    )
    if not ok:
        raise HTTPException(status_code=403, detail=reason)
    return user


@router.delete("/{meetup_id}/matches/{match_id}/goals/{goal_id}", status_code=204)
async def remove_goal(
    meetup_id: int,
    match_id: int,
    goal_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_require_goal_deleter),
):
    """Soft-delete one goal, recompute counters, broadcast ``goal_removed``."""
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

    goal.deleted_at = utcnow()
    await db.flush()
    score_a, score_b = await _recompute_scores(db, match)
    await db.commit()

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
