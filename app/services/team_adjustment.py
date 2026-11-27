"""Expand / contract teams by adjusting max_teams and auto-promoting waitlisted players."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meetup import Attendance, Meetup
from app.models.match import MeetupMatch
from app.models.user import User
from app.core.json_column import loads_int_list
from app.core.timeutil import utcnow
from app.services.manual_teams import (
    ensure_team_names,
    format_teams_api_payload,
    get_team_names,
    parse_manual_teams_json,
    resolve_meetup_teams_nested,
)
from app.services.team_names import team_name as _team_name
from app.services.meetup_revision import (
    bump_meetup_revision,
    notify_meetup_data_changed,
)
from app.services.meetup_signup import active_hold_times
from app.services.team_assignment import DEFAULT_TEAM_SIZE, MIN_TEAMS, draft_skill, team_counts
from app.services.rating_settings import get_rating_settings, selected_rating


def _compute_capacity(n_teams: int) -> int:
    """Maximum confirmed players for a given number of teams."""
    return n_teams * DEFAULT_TEAM_SIZE


async def _load_meetup_players(
    db: AsyncSession, meetup_id: int
) -> tuple[
    list[dict[str, Any]],  # confirmed players
    list[tuple[Attendance, User]],  # waitlisted (attendance, user) ordered by joined_at ASC
]:
    """Load confirmed player dicts and waitlisted attendance rows."""
    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(Attendance.meetup_id == meetup_id)
        .order_by(Attendance.joined_at.asc())
    )
    rows = result.all()

    computed_scores = (await get_rating_settings(db)).computed_scores

    def _player_dict(u: User) -> dict[str, Any]:
        skill = selected_rating(u, computed_scores)
        return {
            "id": str(u.id),
            "name": u.display_name,
            "skill": draft_skill(skill),
            "user_id": u.id,
            "avatar_url": u.avatar_url,
            "primary_specialty": u.primary_specialty,
            "secondary_specialty": u.secondary_specialty,
            "calculated_skill": skill,
            "pac": u.pac,
            "dri": u.dri,
        }

    confirmed: list[dict[str, Any]] = []
    waitlisted: list[tuple[Attendance, User]] = []
    for att, user in rows:
        if att.status == "confirmed":
            confirmed.append(_player_dict(user))
        elif att.status == "waitlisted":
            waitlisted.append((att, user))

    return confirmed, waitlisted


async def fill_empty_pending_matches(db: AsyncSession, meetup: Meetup) -> None:
    """Fill pending sides left empty by a reshape as players sign up."""
    if meetup.team_size is None:
        return
    matches = (await db.execute(
        select(MeetupMatch).where(
            MeetupMatch.meetup_id == meetup.id, MeetupMatch.status == "pending"
        )
    )).scalars().all()
    empty = [m for m in matches if not loads_int_list(m.team_a_users) or not loads_int_list(m.team_b_users)]
    if not empty:
        return
    players, _ = await _load_meetup_players(db, meetup.id)
    teams = resolve_meetup_teams_nested(
        meetup.manual_teams_json, meetup.team_assignment_mode, players,
        max_teams=meetup.max_teams, team_size=meetup.team_size,
    )
    names = get_team_names(meetup) or []
    open_matches = matches
    if meetup.two_pitch:
        open_matches = list(await db.scalars(
            select(MeetupMatch).where(
                MeetupMatch.meetup_id == meetup.id,
                MeetupMatch.status.in_(("pending", "active", "time_up")),
            )
        ))
    for match in empty:
        occupied = {
            uid
            for other in open_matches if other.id != match.id
            for uid in loads_int_list(other.team_a_users) + loads_int_list(other.team_b_users)
        } if meetup.two_pitch else set()
        available = [
            (idx, [player for player in team if player["user_id"] not in occupied])
            for idx, team in enumerate(teams)
            if not meetup.max_teams or idx < meetup.max_teams
        ]
        available = [(idx, team) for idx, team in available if team]
        if len(available) < 2:
            continue
        # Reuse this match's team names when those sides are still available.
        preferred = {
            names[idx] if idx < len(names) else _team_name(idx + 1): (idx, team)
            for idx, team in available
        }
        sides = [preferred.get(match.team_a_name), preferred.get(match.team_b_name)]
        if None in sides or sides[0][0] == sides[1][0]:
            sides = available[:2]
        (a_idx, a), (b_idx, b) = sides
        match.team_a_users = json.dumps([p["user_id"] for p in a])
        match.team_b_users = json.dumps([p["user_id"] for p in b])
        match.team_a_name = names[a_idx] if a_idx < len(names) else _team_name(a_idx + 1)
        match.team_b_name = names[b_idx] if b_idx < len(names) else _team_name(b_idx + 1)


async def refresh_after_confirmed_roster_change(db: AsyncSession, meetup: Meetup) -> None:
    if not await redraft_before_first_match(db, meetup):
        await fill_empty_pending_matches(db, meetup)


async def redraft_before_first_match(db: AsyncSession, meetup: Meetup) -> bool:
    """Redraft an auto-balanced lineup before the first match starts."""
    if meetup.team_assignment_mode != "auto-balanced":
        return False

    matches = (await db.scalars(
        select(MeetupMatch).where(MeetupMatch.meetup_id == meetup.id)
    )).all()
    if any(match.status != "pending" for match in matches):
        return False
    if not matches and meetup.manual_teams_json is None:
        return False

    saved = parse_manual_teams_json(meetup.manual_teams_json)
    meetup.manual_teams_json = None
    if not matches:
        return True  # The Teams endpoint drafts from the new confirmed roster.

    players, _ = await _load_meetup_players(db, meetup.id)
    teams = resolve_meetup_teams_nested(
        None, meetup.team_assignment_mode, players,
        max_teams=meetup.max_teams, team_size=meetup.team_size,
    )
    lineup = [[player["user_id"] for player in team] for team in teams]
    meetup.manual_teams_json = json.dumps(lineup)
    names = get_team_names(meetup) or []
    slots = lineup + [[] for _ in range(max(len(names), len(saved or [])) - len(lineup))]
    by_name = {
        names[index] if index < len(names) else _team_name(index + 1): team
        for index, team in enumerate(slots)
    }
    by_previous_roster = {
        frozenset(previous): team for previous, team in zip(saved or [], slots)
    }
    for match in matches:
        for side in ("a", "b"):
            roster_field = f"team_{side}_users"
            team = by_name.get(getattr(match, f"team_{side}_name"))
            if team is None:
                previous = frozenset(loads_int_list(getattr(match, roster_field)))
                team = by_previous_roster.get(previous)
            if team is not None:
                setattr(match, roster_field, json.dumps(team))
    return True


async def expand_teams(
    db: AsyncSession,
    meetup: Meetup,
    num_teams: int = 1,
) -> dict[str, Any]:
    """Add *num_teams* teams and auto-promote waitlisted players (FIFO by joined_at).

    Returns a payload suitable for the API response.
    """
    if num_teams < 1:
        return {"error": "num_teams must be >= 1"}

    confirmed, waitlisted = await _load_meetup_players(db, meetup.id)

    current_max = meetup.max_teams
    # Derive current effective team count
    current_n = len(team_counts(len(confirmed), max_teams=current_max))
    new_max_teams = max(current_max or current_n, current_n + num_teams)

    new_capacity = _compute_capacity(new_max_teams)
    spots_open = new_capacity - len(confirmed)

    if spots_open <= 0:
        return {
            "error": "No additional capacity created",
            "max_teams": meetup.max_teams,
        }

    # Promote waitlisted players (FIFO by joined_at — already sorted)
    promoted_ids: list[int] = []
    holds = await active_hold_times(db, meetup.id, utcnow())
    for att, _user in waitlisted:
        if len(promoted_ids) + sum(at < att.joined_at for at in holds) >= spots_open:
            break
        att.status = "confirmed"
        promoted_ids.append(att.user_id)

    # Update meetup
    meetup.max_teams = new_max_teams
    meetup.team_size = None
    meetup.manual_teams_json = None  # force algorithmic re-assignment

    # Ensure enough team names
    ensure_team_names(meetup, new_max_teams)

    # Re-resolve teams with updated confirmed roster
    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(
            Attendance.meetup_id == meetup.id,
            Attendance.status == "confirmed",
        )
    )
    computed_scores = (await get_rating_settings(db)).computed_scores
    updated_confirmed = [
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
        for _, u in result.all()
    ]

    mode = getattr(meetup, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_meetup_teams_nested(
        None, mode, updated_confirmed, max_teams=new_max_teams
    )
    team_names = json.loads(meetup.team_names_json) if meetup.team_names_json else None

    rev = await bump_meetup_revision(db, meetup.id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup.id, rev)

    return {
        "operation": "expand",
        "max_teams": new_max_teams,
        "teams": format_teams_api_payload(teams_nested, team_names),
        "promoted_user_ids": promoted_ids,
        "content_revision": rev or 0,
    }


async def contract_teams(
    db: AsyncSession,
    meetup: Meetup,
    num_teams: int = 1,
) -> dict[str, Any]:
    """Remove *num_teams* teams and return excess confirmed players to waitlist (LIFO).

    Returns a payload suitable for the API response.
    """
    if num_teams < 1:
        return {"error": "num_teams must be >= 1"}

    if meetup.max_teams is None:
        return {"error": "Cannot contract — max_teams is not set (auto mode)"}

    confirmed, _waitlisted = await _load_meetup_players(db, meetup.id)

    current_max = meetup.max_teams
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
            Attendance.meetup_id == meetup.id,
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

    # Update meetup
    meetup.max_teams = new_max_teams
    meetup.team_size = None
    meetup.manual_teams_json = None  # force algorithmic re-assignment

    # Ensure enough team names (may have fewer now, which is fine)
    ensure_team_names(meetup, new_max_teams)

    # Re-resolve teams with updated confirmed roster
    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(
            Attendance.meetup_id == meetup.id,
            Attendance.status == "confirmed",
        )
    )
    computed_scores = (await get_rating_settings(db)).computed_scores
    updated_confirmed = [
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
        for _, u in result.all()
    ]

    mode = getattr(meetup, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_meetup_teams_nested(
        None, mode, updated_confirmed, max_teams=new_max_teams
    )
    team_names = json.loads(meetup.team_names_json) if meetup.team_names_json else None

    rev = await bump_meetup_revision(db, meetup.id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup.id, rev)

    return {
        "operation": "contract",
        "max_teams": new_max_teams,
        "teams": format_teams_api_payload(teams_nested, team_names),
        "returned_user_ids": returned_ids,
        "content_revision": rev or 0,
    }
