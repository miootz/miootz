"""Expand / contract teams by adjusting max_teams and auto-promoting waitlisted players."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import Attendance, GameSession
from app.models.user import User
from app.services.manual_teams import (
    ensure_team_names,
    format_teams_api_payload,
    resolve_session_teams_nested,
)
from app.services.session_revision import (
    bump_session_revision,
    notify_session_data_changed,
)
from app.services.team_assignment import DEFAULT_TEAM_SIZE, MIN_TEAMS, team_counts


def _compute_capacity(n_teams: int) -> int:
    """Maximum confirmed players for a given number of teams."""
    return n_teams * DEFAULT_TEAM_SIZE


async def _load_session_players(
    db: AsyncSession, session_id: int
) -> tuple[
    list[dict[str, Any]],  # confirmed players
    list[tuple[Attendance, User]],  # waitlisted (attendance, user) ordered by joined_at ASC
]:
    """Load confirmed player dicts and waitlisted attendance rows."""
    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(Attendance.session_id == session_id)
        .order_by(Attendance.joined_at.asc())
    )
    rows = result.all()

    def _player_dict(u: User) -> dict[str, Any]:
        skill = u.calculated_skill if u.calculated_skill is not None else (
            float(u.self_assessed_skill) if u.self_assessed_skill is not None else 50.0
        )
        return {
            "id": str(u.id),
            "name": u.display_name,
            "skill": skill,
            "user_id": u.id,
            "avatar_url": u.avatar_url,
            "primary_specialty": u.primary_specialty,
            "secondary_specialty": u.secondary_specialty,
            "calculated_skill": u.calculated_skill,
        }

    confirmed: list[dict[str, Any]] = []
    waitlisted: list[tuple[Attendance, User]] = []
    for att, user in rows:
        if att.status == "confirmed":
            confirmed.append(_player_dict(user))
        elif att.status == "waitlisted":
            waitlisted.append((att, user))

    return confirmed, waitlisted


async def expand_teams(
    db: AsyncSession,
    session: GameSession,
    num_teams: int = 1,
) -> dict[str, Any]:
    """Add *num_teams* teams and auto-promote waitlisted players (FIFO by joined_at).

    Returns a payload suitable for the API response.
    """
    if num_teams < 1:
        return {"error": "num_teams must be >= 1"}

    confirmed, waitlisted = await _load_session_players(db, session.id)

    current_max = session.max_teams
    # Derive current effective team count
    current_n = len(team_counts(len(confirmed), max_teams=current_max))
    new_max_teams = max(current_max or current_n, current_n + num_teams)

    new_capacity = _compute_capacity(new_max_teams)
    spots_open = new_capacity - len(confirmed)

    if spots_open <= 0:
        return {
            "error": "No additional capacity created",
            "max_teams": session.max_teams,
        }

    # Promote waitlisted players (FIFO by joined_at — already sorted)
    promoted_ids: list[int] = []
    to_promote = min(spots_open, len(waitlisted))
    for i in range(to_promote):
        att, _user = waitlisted[i]
        att.status = "confirmed"
        promoted_ids.append(att.user_id)

    # Update session
    session.max_teams = new_max_teams
    session.manual_teams_json = None  # force algorithmic re-assignment

    # Ensure enough team names
    ensure_team_names(session, new_max_teams)

    # Re-resolve teams with updated confirmed roster
    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(
            Attendance.session_id == session.id,
            Attendance.status == "confirmed",
        )
    )
    updated_confirmed = [
        {
            "id": str(u.id),
            "name": u.display_name,
            "skill": u.calculated_skill if u.calculated_skill is not None else (
                float(u.self_assessed_skill) if u.self_assessed_skill is not None else 50.0
            ),
            "user_id": u.id,
            "avatar_url": u.avatar_url,
            "primary_specialty": u.primary_specialty,
            "secondary_specialty": u.secondary_specialty,
            "calculated_skill": u.calculated_skill,
        }
        for _, u in result.all()
    ]

    mode = getattr(session, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_session_teams_nested(
        None, mode, updated_confirmed, max_teams=new_max_teams
    )
    team_names = json.loads(session.team_names_json) if session.team_names_json else None

    rev = await bump_session_revision(db, session.id)
    await db.commit()
    if rev is not None:
        await notify_session_data_changed(session.id, rev)

    return {
        "operation": "expand",
        "max_teams": new_max_teams,
        "teams": format_teams_api_payload(teams_nested, team_names),
        "promoted_user_ids": promoted_ids,
        "content_revision": rev or 0,
    }


async def contract_teams(
    db: AsyncSession,
    session: GameSession,
    num_teams: int = 1,
) -> dict[str, Any]:
    """Remove *num_teams* teams and return excess confirmed players to waitlist (LIFO).

    Returns a payload suitable for the API response.
    """
    if num_teams < 1:
        return {"error": "num_teams must be >= 1"}

    if session.max_teams is None:
        return {"error": "Cannot contract — max_teams is not set (auto mode)"}

    confirmed, _waitlisted = await _load_session_players(db, session.id)

    current_max = session.max_teams
    new_max_teams = max(MIN_TEAMS, current_max - num_teams)

    if new_max_teams >= current_max:
        return {
            "error": f"Already at minimum ({MIN_TEAMS} teams)",
            "max_teams": current_max,
        }

    new_capacity = _compute_capacity(new_max_teams)
    excess = len(confirmed) - new_capacity

    # Return excess confirmed players to waitlist (LIFO — most recently joined confirmed first)
    # We need to find the confirmed Attendance rows with the latest joined_at
    result = await db.execute(
        select(Attendance)
        .where(
            Attendance.session_id == session.id,
            Attendance.status == "confirmed",
        )
        .order_by(Attendance.joined_at.desc())
    )
    confirmed_desc = result.scalars().all()

    returned_ids: list[int] = []
    to_return = min(excess, len(confirmed_desc))
    for i in range(to_return):
        att = confirmed_desc[i]
        att.status = "waitlisted"
        returned_ids.append(att.user_id)

    # Update session
    session.max_teams = new_max_teams
    session.manual_teams_json = None  # force algorithmic re-assignment

    # Ensure enough team names (may have fewer now, which is fine)
    ensure_team_names(session, new_max_teams)

    # Re-resolve teams with updated confirmed roster
    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(
            Attendance.session_id == session.id,
            Attendance.status == "confirmed",
        )
    )
    updated_confirmed = [
        {
            "id": str(u.id),
            "name": u.display_name,
            "skill": u.calculated_skill if u.calculated_skill is not None else (
                float(u.self_assessed_skill) if u.self_assessed_skill is not None else 50.0
            ),
            "user_id": u.id,
            "avatar_url": u.avatar_url,
            "primary_specialty": u.primary_specialty,
            "secondary_specialty": u.secondary_specialty,
            "calculated_skill": u.calculated_skill,
        }
        for _, u in result.all()
    ]

    mode = getattr(session, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_session_teams_nested(
        None, mode, updated_confirmed, max_teams=new_max_teams
    )
    team_names = json.loads(session.team_names_json) if session.team_names_json else None

    rev = await bump_session_revision(db, session.id)
    await db.commit()
    if rev is not None:
        await notify_session_data_changed(session.id, rev)

    return {
        "operation": "contract",
        "max_teams": new_max_teams,
        "teams": format_teams_api_payload(teams_nested, team_names),
        "returned_user_ids": returned_ids,
        "content_revision": rev or 0,
    }
