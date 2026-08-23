"""Live match management: start matches, timer, scores, end matches."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_admin
from app.core.database import get_db
from app.core.session_data_manager import session_data_manager
from app.models.match import SessionMatch
from app.models.session import Attendance, GameSession
from app.models.user import User
from app.services.manual_teams import (
    ensure_team_names,
    get_team_names,
    resolve_session_teams_nested,
)
from app.services.session_revision import notify_session_data_changed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["matches"])


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


# ── Helpers ───────────────────────────────────────────────────────


def _compute_timer_remaining(match: SessionMatch) -> int:
    """Compute server-authoritative remaining seconds."""
    if match.timer_started_at is None:
        return match.timer_total_seconds
    if match.status in ("completed",):
        return 0

    started = match.timer_started_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    elapsed = (now - started).total_seconds()

    # Subtract pause intervals
    pause_intervals: list[dict] = []
    if match.timer_pause_intervals:
        try:
            pause_intervals = json.loads(match.timer_pause_intervals)
        except (json.JSONDecodeError, TypeError):
            pass

    for interval in pause_intervals:
        paused_at = interval.get("paused_at")
        resumed_at = interval.get("resumed_at")
        if paused_at:
            pa = datetime.fromisoformat(paused_at).replace(tzinfo=timezone.utc)
            if resumed_at:
                ra = datetime.fromisoformat(resumed_at).replace(tzinfo=timezone.utc)
                elapsed -= (ra - pa).total_seconds()
            else:
                # Currently paused — pause until now
                elapsed -= (now - pa).total_seconds()

    remaining = match.timer_total_seconds - int(elapsed)
    return max(remaining, 0)


def _is_half_time(match: SessionMatch) -> bool:
    """True when timer has crossed the 50% threshold (first half just ended)."""
    if match.timer_started_at is None:
        return False
    remaining = _compute_timer_remaining(match)
    ratio = remaining / match.timer_total_seconds if match.timer_total_seconds > 0 else 1
    # Half-time window: between 55% and 45% of total time (just crossed 50%)
    return ratio <= 0.55 and ratio >= 0.45


def _timer_ends_at_iso(match: SessionMatch) -> str | None:
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
    except (json.JSONDecodeError, TypeError):
        intervals = []
    ends = match.timer_started_at.replace(tzinfo=timezone.utc) + timedelta(
        seconds=match.timer_total_seconds
    )
    for interval in intervals:
        paused_at = interval.get("paused_at")
        resumed_at = interval.get("resumed_at")
        if paused_at and resumed_at:
            pa = datetime.fromisoformat(paused_at).replace(tzinfo=timezone.utc)
            ra = datetime.fromisoformat(resumed_at).replace(tzinfo=timezone.utc)
            ends -= ra - pa
    return ends.isoformat()


async def _check_timer_expiry(
    match: SessionMatch, db: AsyncSession  # pylint: disable=unused-argument
) -> bool:
    """If timer has expired, auto-transition to 'time_up' and broadcast.
    Returns True if the match was transitioned."""
    if match.status != "active":
        return False
    remaining = _compute_timer_remaining(match)
    if remaining <= 0:
        match.status = "time_up"
        match.timer_seconds_remaining = 0
        await db.flush()
        await _broadcast_match_event(match.session_id, {
            "type": "match_timer_expired",
            "match_id": match.id,
            "seconds_remaining": 0,
            "status": "time_up",
        })
        session = await db.get(GameSession, match.session_id)
        await notify_session_data_changed(
            match.session_id, (session.content_revision or 0) + 1  # type: ignore[attr-defined]
        )
        return True
    return False


def _match_json(match: SessionMatch, users_by_id: dict[int, dict]) -> dict:
    """Serialize a SessionMatch with user details."""
    team_a_users: list[int] = json.loads(match.team_a_users)
    team_b_users: list[int] = json.loads(match.team_b_users)

    def _user_list(ids: list[int]) -> list[dict]:
        result = []
        for uid in ids:
            u = users_by_id.get(uid)
            if u:
                result.append(u)
            else:
                result.append({"id": uid, "display_name": f"User {uid}", "avatar_url": None})
        return result

    out = {
        "id": match.id,
        "session_id": match.session_id,
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
        "timer_paused": match.timer_pause_intervals is not None and _is_currently_paused(match),
        "timer_ends_at": _timer_ends_at_iso(match),
        "is_half_time": _is_half_time(match) if match.status == "active" else False,
        "created_at": match.created_at.isoformat() if match.created_at else None,
        "completed_at": match.completed_at.isoformat() if match.completed_at else None,
    }
    return out


def _is_currently_paused(match: SessionMatch) -> bool:
    """Check if the last pause interval has no resumed_at (currently paused)."""
    if not match.timer_pause_intervals:
        return False
    try:
        intervals = json.loads(match.timer_pause_intervals)
        if intervals:
            return intervals[-1].get("resumed_at") is None
    except (json.JSONDecodeError, TypeError):
        pass
    return False


async def _load_users_for_session(db: AsyncSession, session_id: int) -> dict[int, dict]:
    """Load all users who have any attendance for this session."""
    from app.models.session import Attendance

    result = await db.execute(
        select(User, Attendance)
        .join(Attendance, Attendance.user_id == User.id)
        .where(Attendance.session_id == session_id)
    )
    users: dict[int, dict] = {}
    for user, _ in result:
        users[user.id] = {
            "id": user.id,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
        }
    return users


async def _broadcast_match_event(session_id: int, event: dict) -> None:
    """Broadcast a match event via the session data SSE channel."""
    await session_data_manager.broadcast(session_id, event)


# ── Endpoints ─────────────────────────────────────────────────────


@router.get("/{session_id}/matches")
async def list_session_matches(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """List all matches for a session (public)."""
    session = await db.get(GameSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(SessionMatch)
        .where(SessionMatch.session_id == session_id)
        .order_by(SessionMatch.match_number.asc())
    )
    matches = result.scalars().all()

    users_by_id = await _load_users_for_session(db, session_id)
    return {
        "matches": [_match_json(m, users_by_id) for m in matches],
        "match_duration_minutes": session.match_duration_minutes or 10,
    }


@router.get("/{session_id}/matches/{match_id}")
async def get_match(
    session_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get a single match with timer state (public)."""
    match = await db.get(SessionMatch, match_id)
    if not match or match.session_id != session_id:
        raise HTTPException(status_code=404, detail="Match not found")

    # Auto-transition expired timer
    await _check_timer_expiry(match, db)

    users_by_id = await _load_users_for_session(db, session_id)
    return _match_json(match, users_by_id)


@router.post("/{session_id}/matches/start", status_code=201)
async def start_matches(
    session_id: int,
    body: StartMatchesBody | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Start the match session. Creates the first match (Team 1 vs Team 2 by default,
    or the given team indices when provided)."""
    session = await db.get(GameSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Check if matches already exist
    existing = await db.execute(
        select(SessionMatch)
        .where(SessionMatch.session_id == session_id)
        .order_by(SessionMatch.match_number.asc())
        .limit(1)
    )
    first = existing.scalar_one_or_none()
    if first:
        # Return existing first match (idempotent)
        users_by_id = await _load_users_for_session(db, session_id)
        return {"status": "already_started", "match": _match_json(first, users_by_id)}

    # Load confirmed players
    result = await db.execute(
        select(User)
        .join(Attendance, Attendance.user_id == User.id)
        .where(
            Attendance.session_id == session_id,
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
    mode = getattr(session, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_session_teams_nested(
        getattr(session, "manual_teams_json", None),
        mode,
        players,
    )
    if len(teams_nested) < 2:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least 2 teams to start matches. Found {len(teams_nested)}.",
        )

    # Ensure team names exist
    team_names = ensure_team_names(session, len(teams_nested))
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

    match_duration = session.match_duration_minutes or 10

    match = SessionMatch(
        session_id=session_id,
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
    await notify_session_data_changed(session_id, (session.content_revision or 0) + 1)  # type: ignore[attr-defined]
    await _broadcast_match_event(session_id, {
        "type": "match_created",
        "match_id": match.id,
        "match_number": 1,
    })

    users_by_id = await _load_users_for_session(db, session_id)
    return {"status": "started", "match": _match_json(match, users_by_id)}


@router.post("/{session_id}/matches/new", status_code=201)
async def create_new_pending_match(
    session_id: int,
    body: CreatePendingMatchBody | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Create a fresh pending match for the next round.

    Accepts optional team_a_idx and team_b_idx to pick specific teams.
    If not provided, picks the last match winner as team A and the next
    unplayed (or any available) team as team B.
    """
    session = await db.get(GameSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Find the last match to determine match number
    existing = await db.execute(
        select(SessionMatch)
        .where(SessionMatch.session_id == session_id)
        .order_by(SessionMatch.match_number.desc())
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
            Attendance.session_id == session_id,
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

    mode = getattr(session, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_session_teams_nested(
        getattr(session, "manual_teams_json", None),
        mode,
        players,
    )
    team_names = get_team_names(session)

    body = body or CreatePendingMatchBody()
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
        team_a_name = (team_names[body.team_a_idx] if team_names and body.team_a_idx < len(team_names)
                       else f"Team {body.team_a_idx + 1}")
        team_b_name = (team_names[body.team_b_idx] if team_names and body.team_b_idx < len(team_names)
                       else f"Team {body.team_b_idx + 1}")
    else:
        # Auto-pick: last match winner vs next available team
        winner_users: list[int] = json.loads(
            last_match.team_a_users if last_match.score_a > last_match.score_b
            else last_match.team_b_users
        )
        winner_name = (
            last_match.team_a_name if last_match.score_a > last_match.score_b
            else last_match.team_b_name
        )

        # Find which teams have already entered
        all_matches = await db.execute(
            select(SessionMatch)
            .where(SessionMatch.session_id == session_id)
            .order_by(SessionMatch.match_number.asc())
        )
        played_matches = all_matches.scalars().all()

        used_team_indices: set[int] = set()
        for m in played_matches:
            ma_users = set(json.loads(m.team_a_users))
            mb_users = set(json.loads(m.team_b_users))
            for idx, team in enumerate(teams_nested):
                team_user_ids = set(p["user_id"] for p in team)
                if team_user_ids == ma_users or team_user_ids == mb_users:
                    used_team_indices.add(idx)

        import random as _random
        unplayed_indices = [idx for idx in range(len(teams_nested)) if idx not in used_team_indices]
        if unplayed_indices:
            next_team_idx = unplayed_indices[0]
        else:
            available = [idx for idx in range(len(teams_nested))
                         if set(p["user_id"] for p in teams_nested[idx]) != set(winner_users)]
            if not available:
                raise HTTPException(
                    status_code=400,
                    detail="Not enough teams for another match.",
                )
            next_team_idx = _random.choice(available)

        team_a_users_list = winner_users  # already a list of ints
        team_b = teams_nested[next_team_idx]
        team_a_name = winner_name
        team_b_name = (team_names[next_team_idx] if team_names and next_team_idx < len(team_names)
                       else f"Team {next_team_idx + 1}")
        team_b_users_list = [p["user_id"] for p in team_b]

    match_duration = session.match_duration_minutes or 10

    # Build user lists for the new match
    if body.team_a_idx is not None:
        team_a_users_list = [p["user_id"] for p in team_a]
        team_b_users_list = [p["user_id"] for p in team_b]

    new_match = SessionMatch(
        session_id=session_id,
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

    await notify_session_data_changed(session_id, (session.content_revision or 0) + 1)  # type: ignore[attr-defined]

    users_by_id = await _load_users_for_session(db, session_id)
    return {"status": "created", "match": _match_json(new_match, users_by_id)}


@router.delete("/{session_id}/matches/{match_id}", status_code=204)
async def delete_match(
    session_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Delete a match (admin only)."""
    match = await db.get(SessionMatch, match_id)
    if not match or match.session_id != session_id:
        raise HTTPException(status_code=404, detail="Match not found")
    await db.delete(match)
    await db.commit()
    await notify_session_data_changed(session_id, (session_id or 0) + 1)


@router.post("/{session_id}/matches/create", status_code=201)
async def create_match(
    session_id: int,
    body: MatchCreateBody,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Create a completed match directly (admin, for retroactive score entry)."""
    session = await db.get(GameSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Find the next match number
    existing = await db.execute(
        select(SessionMatch)
        .where(SessionMatch.session_id == session_id)
        .order_by(SessionMatch.match_number.desc())
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

    match = SessionMatch(
        session_id=session_id,
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
        completed_at=datetime.now(timezone.utc),
    )
    db.add(match)
    await db.commit()
    await db.refresh(match)

    await notify_session_data_changed(session_id, (session.content_revision or 0) + 1)  # type: ignore[attr-defined]

    users_by_id: dict[int, User] = {}
    return {"status": "created", "match": _match_json(match, users_by_id)}


@router.patch("/{session_id}/matches/{match_id}/teams")
async def swap_match_teams(
    session_id: int,
    match_id: int,
    body: MatchTeamSwap,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Swap/edit team composition before match starts."""
    match = await db.get(SessionMatch, match_id)
    if not match or match.session_id != session_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot swap teams for a {match.status} match.",
        )

    match.team_a_users = json.dumps(body.team_a_users)
    match.team_b_users = json.dumps(body.team_b_users)
    await db.commit()
    await db.refresh(match)

    await notify_session_data_changed(session_id, (session.content_revision or 0) + 1)  # type: ignore[attr-defined]
    users_by_id = await _load_users_for_session(db, session_id)
    return _match_json(match, users_by_id)


@router.post("/{session_id}/matches/{match_id}/timer/start")
async def start_timer(
    session_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Start the match timer."""
    match = await db.get(SessionMatch, match_id)
    if not match or match.session_id != session_id:
        raise HTTPException(status_code=404, detail="Match not found")

    match.timer_started_at = datetime.now(timezone.utc)
    match.timer_seconds_remaining = match.timer_total_seconds
    match.timer_pause_intervals = "[]"
    match.status = "active"
    await db.commit()

    await _broadcast_match_event(session_id, {
        "type": "match_timer_started",
        "match_id": match.id,
        "seconds_remaining": match.timer_total_seconds,
        "status": "active",
        "is_half_time": False,
        "ends_at": _timer_ends_at_iso(match),
    })

    session = await db.get(GameSession, session_id)
    await notify_session_data_changed(session_id, (session.content_revision or 0) + 1)  # type: ignore[attr-defined]

    return {
        "status": "started",
        "seconds_remaining": match.timer_total_seconds,
    }


@router.post("/{session_id}/matches/{match_id}/timer/pause")
async def pause_timer(
    session_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Pause the match timer."""
    match = await db.get(SessionMatch, match_id)
    if not match or match.session_id != session_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status not in ("active",):
        raise HTTPException(status_code=409, detail="Timer is not running.")

    now = datetime.now(timezone.utc)
    remaining = _compute_timer_remaining(match)

    intervals: list[dict] = []
    if match.timer_pause_intervals:
        try:
            intervals = json.loads(match.timer_pause_intervals)
        except (json.JSONDecodeError, TypeError):
            pass
    intervals.append({"paused_at": now.isoformat(), "resumed_at": None})
    match.timer_pause_intervals = json.dumps(intervals)
    match.timer_seconds_remaining = remaining

    await db.commit()

    await _broadcast_match_event(session_id, {
        "type": "match_timer_paused",
        "match_id": match.id,
        "seconds_remaining": remaining,
        "is_half_time": _is_half_time(match),
        "ends_at": None,
    })

    session = await db.get(GameSession, session_id)
    await notify_session_data_changed(session_id, (session.content_revision or 0) + 1)  # type: ignore[attr-defined]

    return {
        "status": "paused",
        "seconds_remaining": remaining,
    }


@router.post("/{session_id}/matches/{match_id}/timer/resume")
async def resume_timer(
    session_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Resume the match timer."""
    match = await db.get(SessionMatch, match_id)
    if not match or match.session_id != session_id:
        raise HTTPException(status_code=404, detail="Match not found")

    intervals: list[dict] = []
    if match.timer_pause_intervals:
        try:
            intervals = json.loads(match.timer_pause_intervals)
        except (json.JSONDecodeError, TypeError):
            pass

    if not intervals or intervals[-1].get("resumed_at") is not None:
        raise HTTPException(status_code=409, detail="Timer is not paused.")

    now = datetime.now(timezone.utc)
    intervals[-1]["resumed_at"] = now.isoformat()
    match.timer_pause_intervals = json.dumps(intervals)

    remaining = _compute_timer_remaining(match)
    match.timer_seconds_remaining = remaining

    await db.commit()

    await _broadcast_match_event(session_id, {
        "type": "match_timer_resumed",
        "match_id": match.id,
        "seconds_remaining": remaining,
        "is_half_time": _is_half_time(match),
        "ends_at": _timer_ends_at_iso(match),
    })

    session = await db.get(GameSession, session_id)
    await notify_session_data_changed(session_id, (session.content_revision or 0) + 1)  # type: ignore[attr-defined]

    return {
        "status": "resumed",
        "seconds_remaining": remaining,
    }


@router.post("/{session_id}/matches/{match_id}/timer/reset")
async def reset_timer(
    session_id: int,
    match_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Reset timer and scores for current match (admin only, active match)."""
    match = await db.get(SessionMatch, match_id)
    if not match or match.session_id != session_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status not in ("active", "time_up"):
        raise HTTPException(status_code=409, detail="Can only reset an active or time_up match.")

    match.timer_started_at = None
    match.timer_seconds_remaining = None
    match.timer_pause_intervals = None
    match.score_a = 0
    match.score_b = 0
    match.status = "pending"
    await db.commit()

    await _broadcast_match_event(session_id, {
        "type": "match_reset",
        "match_id": match.id,
    })

    session = await db.get(GameSession, session_id)
    await notify_session_data_changed(session_id, (session.content_revision or 0) + 1)  # type: ignore[attr-defined]

    users_by_id = await _load_users_for_session(db, session_id)
    return _match_json(match, users_by_id)


@router.post("/{session_id}/matches/{match_id}/score")
async def increment_score(
    session_id: int,
    match_id: int,
    body: MatchScoreDelta,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Increment score for a team (+1 by default)."""
    match = await db.get(SessionMatch, match_id)
    if not match or match.session_id != session_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status not in ("active", "time_up"):
        raise HTTPException(status_code=409, detail="Can only score during an active match.")

    if body.team == "a":
        match.score_a = max(0, match.score_a + body.delta)
    else:
        match.score_b = max(0, match.score_b + body.delta)
    await db.commit()

    await _broadcast_match_event(session_id, {
        "type": "match_score_updated",
        "match_id": match.id,
        "team": body.team,
        "score_a": match.score_a,
        "score_b": match.score_b,
    })

    session = await db.get(GameSession, session_id)
    await notify_session_data_changed(session_id, (session.content_revision or 0) + 1)  # type: ignore[attr-defined]

    return {
        "score_a": match.score_a,
        "score_b": match.score_b,
    }


@router.patch("/{session_id}/matches/{match_id}/score")
async def set_score(
    session_id: int,
    match_id: int,
    body: MatchScoreSet,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Set scores directly (bulk correction)."""
    match = await db.get(SessionMatch, match_id)
    if not match or match.session_id != session_id:
        raise HTTPException(status_code=404, detail="Match not found")
    match.score_a = body.score_a
    match.score_b = body.score_b
    await db.commit()

    await _broadcast_match_event(session_id, {
        "type": "match_score_updated",
        "match_id": match.id,
        "score_a": match.score_a,
        "score_b": match.score_b,
    })

    session = await db.get(GameSession, session_id)
    await notify_session_data_changed(session_id, (session.content_revision or 0) + 1)  # type: ignore[attr-defined]

    return {
        "score_a": match.score_a,
        "score_b": match.score_b,
    }


@router.post("/{session_id}/matches/{match_id}/end")
async def end_match(
    session_id: int,
    match_id: int,
    body: MatchEndBody,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """End the current match. Winner stays on pitch; next team enters."""
    match = await db.get(SessionMatch, match_id)
    if not match or match.session_id != session_id:
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

    # Complete current match
    now = datetime.now(timezone.utc)
    match.status = "completed"
    match.completed_at = now
    await db.flush()

    winner_users: list[int] = json.loads(
        match.team_a_users if winner_team == "a" else match.team_b_users
    )
    winner_name = match.team_a_name if winner_team == "a" else match.team_b_name

    # Get all teams for this session to find next team
    _session = await db.get(GameSession, session_id)
    _result = await db.execute(
        select(User)
        .join(Attendance, Attendance.user_id == User.id)
        .where(
            Attendance.session_id == session_id,
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
    _mode = getattr(_session, "team_assignment_mode", None) or "balanced"
    teams = resolve_session_teams_nested(
        getattr(_session, "manual_teams_json", None),
        _mode,
        _players,
    )
    team_names = get_team_names(_session)

    # Find which teams have already been used as the "entering" side
    all_matches = await db.execute(
        select(SessionMatch)
        .where(SessionMatch.session_id == session_id)
        .where(SessionMatch.match_number <= match.match_number)
        .order_by(SessionMatch.match_number.asc())
    )
    played_matches = all_matches.scalars().all()

    # Track which team indices have entered
    used_team_indices: set[int] = set()
    for m in played_matches:
        ma_users = set(json.loads(m.team_a_users))
        mb_users = set(json.loads(m.team_b_users))
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

    # Build winner team info from current teams (match winner users may differ from original teams)
    winner_team_info = None
    for team in teams:
        team_user_ids = set(p["user_id"] for p in team)
        if team_user_ids == set(winner_users):
            winner_team_info = team
            break

    next_match_data: dict | None = None
    if next_team is not None:
        used_team_indices.add(next_team_idx)
        next_team_name = (
            team_names[next_team_idx]
            if team_names and next_team_idx < len(team_names)
            else f"Team {next_team_idx + 1}"
        )
        next_match = SessionMatch(
            session_id=session_id,
            match_number=match.match_number + 1,
            team_a_users=json.dumps(winner_users),
            team_b_users=json.dumps([p["user_id"] for p in next_team]),
            team_a_name=winner_name,
            team_b_name=next_team_name,
            score_a=0,
            score_b=0,
            status="pending",
            timer_total_seconds=match.timer_total_seconds,
        )
        db.add(next_match)
        await db.flush()
        users_by_id = await _load_users_for_session(db, session_id)
        next_match_data = _match_json(next_match, users_by_id)

    await db.commit()

    await _broadcast_match_event(session_id, {
        "type": "match_ended",
        "match_id": match.id,
        "match_number": match.match_number,
        "winner_team": winner_team,
        "winner_name": winner_name,
    })

    session = await db.get(GameSession, session_id)
    await notify_session_data_changed(session_id, (session.content_revision or 0) + 1)  # type: ignore[attr-defined]

    users_by_id = await _load_users_for_session(db, session_id)
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
