"""Persisted manual team lineups (admin) vs algorithmic assignment."""

from __future__ import annotations

import json
from typing import Any

from app.services.team_assignment import (
    assign_teams_random,
    assign_teams_snake,
    rebalance_around_locked,
    team_counts,
)
from app.services.team_names import generate_team_names


def parse_manual_teams_json(raw: str | None) -> list[list[int]] | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, list):
        return None
    out: list[list[int]] = []
    for team in data:
        if not isinstance(team, list):
            return None
        row: list[int] = []
        for x in team:
            row.append(int(x))
        out.append(row)
    return out


def validate_team_partition(
    teams: list[list[int]],
    confirmed_ids: set[int],
    max_teams: int | None = None,
) -> bool:
    """Teams must partition `confirmed_ids` (no duplicates, everyone placed).

    With *max_teams* set, the stored layout is N playing teams plus at most
    ONE (possibly incomplete) bench team — sizes are the admin's intent, so
    only the team COUNT is checked. Without it, sizes must match the
    balanced team_counts(n) algorithm.
    """
    n = len(confirmed_ids)
    if n == 0:
        return teams == []

    flat = [uid for team in teams for uid in team]
    if len(flat) != len(set(flat)):
        return False
    if set(flat) != confirmed_ids:
        return False
    if max_teams is not None:
        # N playing teams + optional single bench team (any size, even one).
        return min(n, max_teams) <= len(teams) <= max_teams + 1
    expected = team_counts(n, max_teams=max_teams)
    if len(teams) != len(expected):
        return False
    if sorted(len(t) for t in teams) != sorted(expected):
        return False
    return True


def build_teams_from_manual(
    players: list[dict[str, Any]],
    manual: list[list[int]],
) -> list[list[dict[str, Any]]]:
    by_id = {int(p["id"]): p for p in players}
    return [[by_id[uid] for uid in team] for team in manual]


def resolve_meetup_teams_nested(
    manual_teams_json: str | None,
    team_assignment_mode: str,
    players: list[dict[str, Any]],
    max_teams: int | None = None,
    team_size: int | None = None,
) -> list[list[dict[str, Any]]]:
    """Algorithm or stored manual lineup (when valid for current confirmed roster)."""
    confirmed_ids = {int(p["id"]) for p in players}
    manual = parse_manual_teams_json(manual_teams_json)
    if manual is not None and validate_team_partition(manual, confirmed_ids, max_teams=max_teams):
        return build_teams_from_manual(players, manual)
    mode = (team_assignment_mode or "balanced").lower()
    if max_teams and team_size and players:
        if manual is not None:
            by_id = {int(p["id"]): p for p in players}
            placed: set[int] = set()
            teams = []
            for row in manual[: max_teams + 1]:
                team = []
                for uid in row:
                    if uid in by_id and uid not in placed:
                        team.append(by_id[uid])
                        placed.add(uid)
                teams.append(team)
            while len(teams) < max_teams:
                teams.append([])
            for player in players:
                if int(player["id"]) in placed:
                    continue
                available = [i for i in range(max_teams) if len(teams[i]) < team_size]
                if available:
                    teams[min(available, key=lambda i: len(teams[i]))].append(player)
                else:
                    if len(teams) == max_teams:
                        teams.append([])
                    teams[max_teams].append(player)
            while teams and len(teams) <= max_teams and not teams[-1]:
                teams.pop()
            return teams
        playing = min(len(players), max_teams * team_size)
        per_team, extra = divmod(playing, max_teams)
        counts = [per_team + (i < extra) for i in range(max_teams)]
        counts = [count for count in counts if count]
        if len(players) > playing:
            counts.append(len(players) - playing)
        lineup = []
        offset = 0
        for count in counts:
            lineup.append([p["user_id"] for p in players[offset : offset + count]])
            offset += count
        return rebalance_around_locked(
            players, lineup, locked=set(), max_teams=max_teams, randomize=mode == "random"
        )
    if mode == "random":
        return assign_teams_random(players, max_teams=max_teams)
    return assign_teams_snake(players, max_teams=max_teams)


def apply_roster_swap(
    manual_teams_json: str | None,
    team_assignment_mode: str,
    players: list[dict[str, Any]],
    old_a: list[int],
    old_b: list[int],
    new_a: list[int],
    new_b: list[int],
    max_teams: int | None = None,
    team_size: int | None = None,
) -> str:
    """Return the manual partition after a pre-start roster swap.

    Swaps only the two teams of the affected match — the other teams (e.g.
    a parallel match's lineup) are untouched. If no manual partition is
    stored, the current resolved teams are captured first, making the swap
    the admin's standing intent for future rounds.
    """
    teams = resolve_meetup_teams_nested(
        manual_teams_json, team_assignment_mode, players, max_teams=max_teams, team_size=team_size
    )
    out: list[list[int]] = [[p["user_id"] for p in t] for t in teams]
    set_a, set_b = set(old_a), set(old_b)
    incoming = set(new_a) | set(new_b)
    released = (set_a | set_b) - incoming  # players who left the match
    suppliers: list[int] = []  # bench team each pulled-in player came from
    for i, team in enumerate(out):
        if set(team) == set_a:
            out[i] = list(new_a)
        elif set(team) == set_b:
            out[i] = list(new_b)
        else:
            # A player pulled in from a non-playing team leaves that team.
            suppliers.extend(i for uid in team if uid in incoming)
            out[i] = [uid for uid in team if uid not in incoming]
    # A swapped-out player takes the incoming player's former spot, so a bench
    # swap is a plain 1-for-1 exchange and the partition stays valid.
    for team_i, uid in zip(suppliers, sorted(released)):
        out[team_i] = out[team_i] + [uid]
    return json.dumps(out)


def get_team_names(meetup: Any) -> list[str] | None:
    """Parse team_names_json from a meetup object."""
    raw = getattr(meetup, "team_names_json", None)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def ensure_team_names(meetup: Any, num_teams: int | None = None) -> list[str]:
    """Ensure the meetup has team names, generating if needed.

    Returns the list of team names. Does NOT persist — caller must flush.
    """
    existing = get_team_names(meetup)
    if existing and len(existing) >= (num_teams or 2):
        return existing

    # Determine number of teams needed
    if num_teams is None:
        num_teams = 2
    names = generate_team_names(num_teams)
    meetup.team_names_json = json.dumps(names)
    return names


def format_teams_api_payload(
    teams_nested: list[list[dict[str, Any]]],
    team_names: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Format resolved teams for the API response.

    When *team_names* is provided (from meetup.team_names_json), uses those
    names. Otherwise falls back to "Team 1", "Team 2", …
    """
    out: list[dict[str, Any]] = []
    for i, team in enumerate(teams_nested, start=1):
        name = (team_names[i - 1] if team_names and i - 1 < len(team_names)
                else f"Team {i}")
        out.append(
            {
                "id": f"t{i}",
                "name": name,
                "players": [
                    {
                        "id": p["id"],
                        "name": p["name"],
                        "skillScore": p["skill"],
                        "isLocked": False,
                        "profilePic": p.get("avatar_url"),
                        "primarySpecialty": p.get("primary_specialty"),
                        "secondarySpecialty": p.get("secondary_specialty"),
                        "calculatedSkill": p.get("calculated_skill"),
                        "pac": p.get("pac"),
                        "dri": p.get("dri"),
                    }
                    for p in team
                ],
            }
        )
    return out
