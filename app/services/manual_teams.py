"""Persisted manual team lineups (admin) vs algorithmic assignment."""

from __future__ import annotations

import json
from typing import Any

from app.services.team_assignment import assign_teams_random, assign_teams_snake, team_counts


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
) -> bool:
    """Teams must partition `confirmed_ids` with sizes matching team_counts(n)."""
    n = len(confirmed_ids)
    expected = team_counts(n)
    if n == 0:
        return teams == []

    flat = [uid for team in teams for uid in team]
    if len(flat) != len(set(flat)):
        return False
    if set(flat) != confirmed_ids:
        return False
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


def resolve_session_teams_nested(
    manual_teams_json: str | None,
    team_assignment_mode: str,
    players: list[dict[str, Any]],
) -> list[list[dict[str, Any]]]:
    """Algorithm or stored manual lineup (when valid for current confirmed roster)."""
    confirmed_ids = {int(p["id"]) for p in players}
    manual = parse_manual_teams_json(manual_teams_json)
    if manual is not None and validate_team_partition(manual, confirmed_ids):
        return build_teams_from_manual(players, manual)
    mode = (team_assignment_mode or "balanced").lower()
    if mode == "random":
        return assign_teams_random(players)
    return assign_teams_snake(players)


def format_teams_api_payload(
    teams_nested: list[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, team in enumerate(teams_nested, start=1):
        out.append(
            {
                "id": f"t{i}",
                "players": [
                    {
                        "id": p["id"],
                        "name": p["name"],
                        "skillScore": p["skill"],
                        "isLocked": False,
                        "profilePic": p.get("profile_pic"),
                    }
                    for p in team
                ],
            }
        )
    return out
