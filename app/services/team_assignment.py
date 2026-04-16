"""
Team sizes: ≤10 players → 2 balanced teams; 11–15 → 3 balanced teams.
Players are sorted by skill (desc) and placed in a snake draft with per-team caps.
"""

from __future__ import annotations

from typing import Any


def team_counts(total: int) -> list[int]:
    if total <= 0:
        return []
    if total <= 10:
        n_teams = 2
    else:
        n_teams = 3
    base = total // n_teams
    rem = total % n_teams
    return [base + (1 if i < rem else 0) for i in range(n_teams)]


def assign_teams_snake(players: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    if not players:
        return []

    counts = team_counts(len(players))
    n_teams = len(counts)
    sorted_p = sorted(
        players, key=lambda x: float(x.get("skill", 0)), reverse=True
    )
    teams: list[list[dict[str, Any]]] = [[] for _ in range(n_teams)]

    for i, p in enumerate(sorted_p):
        round_idx = i // n_teams
        pos = i % n_teams
        tidx = pos if round_idx % 2 == 0 else n_teams - 1 - pos
        attempts = 0
        while len(teams[tidx]) >= counts[tidx] and attempts < n_teams:
            tidx = (tidx + 1) % n_teams
            attempts += 1
        teams[tidx].append(p)

    return teams
