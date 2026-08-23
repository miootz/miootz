"""
Team sizes: ≤10 players → 2 balanced teams; 11–15 → 3 balanced teams.
Balanced: players sorted by skill (desc) then snake draft with per-team caps.
Random: same team sizes, random order then snake draft (reshuffle = new random order).

When max_teams is set, it acts as an upper bound on the number of teams.
Target team size is 5 players per team.
"""

from __future__ import annotations

import math
import random
from typing import Any

DEFAULT_TEAM_SIZE = 5
MIN_TEAMS = 2


def team_counts(total: int, max_teams: int | None = None) -> list[int]:
    """Return per-team size targets that sum to *total*.

    When *max_teams* is None, uses the classic rule: ≤10 → 2 teams, else 3.
    When set, computes ``ceil(total / DEFAULT_TEAM_SIZE)`` capped by *max_teams*,
    floored to at least *MIN_TEAMS*.
    """
    if total <= 0:
        return []

    if max_teams is None:
        n_teams = 2 if total <= 10 else 3
    else:
        n_teams = max(MIN_TEAMS, min(max_teams, math.ceil(total / DEFAULT_TEAM_SIZE)))

    # Never create more teams than players
    n_teams = min(n_teams, total)

    base = total // n_teams
    rem = total % n_teams
    return [base + (1 if i < rem else 0) for i in range(n_teams)]


def _snake_draft(
    ordered_players: list[dict[str, Any]],
    max_teams: int | None = None,
) -> list[list[dict[str, Any]]]:
    if not ordered_players:
        return []

    counts = team_counts(len(ordered_players), max_teams=max_teams)
    n_teams = len(counts)
    teams: list[list[dict[str, Any]]] = [[] for _ in range(n_teams)]

    for i, p in enumerate(ordered_players):
        round_idx = i // n_teams
        pos = i % n_teams
        tidx = pos if round_idx % 2 == 0 else n_teams - 1 - pos
        attempts = 0
        while len(teams[tidx]) >= counts[tidx] and attempts < n_teams:
            tidx = (tidx + 1) % n_teams
            attempts += 1
        teams[tidx].append(p)

    return teams


def assign_teams_snake(
    players: list[dict[str, Any]],
    max_teams: int | None = None,
) -> list[list[dict[str, Any]]]:
    sorted_p = sorted(
        players, key=lambda x: float(x.get("skill", 0)), reverse=True
    )
    return _snake_draft(sorted_p, max_teams=max_teams)


def assign_teams_random(
    players: list[dict[str, Any]],
    max_teams: int | None = None,
) -> list[list[dict[str, Any]]]:
    shuffled = list(players)
    random.shuffle(shuffled)
    return _snake_draft(shuffled, max_teams=max_teams)
