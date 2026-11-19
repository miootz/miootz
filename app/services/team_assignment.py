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


def draft_skill(calculated_skill: float | None) -> float:
    return 3.0 if calculated_skill is None else calculated_skill


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


def _attribute_imbalance(teams: list[list[dict[str, Any]]]) -> int:
    total_players = sum(len(team) for team in teams)
    if not total_players:
        return 0
    total = 0
    for attribute in ("pac", "dri"):
        counts = [
            sum(p.get(attribute) is not None and p[attribute] > 3 for p in team)
            for team in teams
        ]
        players_with_attribute = sum(counts)
        total += sum(
            (count * total_players - players_with_attribute * len(team)) ** 2
            for count, team in zip(counts, teams, strict=True)
        )
    return total


def _balance_attributes(
    teams: list[list[dict[str, Any]]], locked: set[str] | None = None
) -> None:
    """Swap unlocked players to spread above-neutral pace and dribbling."""
    locked = locked or set()

    while True:
        current = _attribute_imbalance(teams)
        if current == 0:
            return
        best = None
        best_score = (current, float("inf"))
        for first in range(len(teams)):
            for second in range(first + 1, len(teams)):
                for i, a in enumerate(teams[first]):
                    if str(a["id"]) in locked:
                        continue
                    for j, b in enumerate(teams[second]):
                        if str(b["id"]) in locked:
                            continue
                        teams[first][i], teams[second][j] = b, a
                        candidate = _attribute_imbalance(teams)
                        totals = [sum(float(p.get("skill", 0)) for p in t) for t in teams]
                        score = (candidate, max(totals) - min(totals))
                        if candidate < current and score < best_score:
                            best, best_score = (first, second, i, j), score
                        teams[first][i], teams[second][j] = a, b
        if best is None:
            return
        first, second, i, j = best
        teams[first][i], teams[second][j] = teams[second][j], teams[first][i]


def _balance_skill(teams: list[list[dict[str, Any]]], locked: set[str]) -> None:
    """Improve rating totals without undoing pace or dribbling distribution."""
    if len(teams) < 2:
        return
    while True:
        totals = [sum(float(p.get("skill", 0)) for p in team) for team in teams]
        current = round(max(totals) - min(totals), 9)
        attribute_score = _attribute_imbalance(teams)
        best = None
        best_diff = current
        for first in range(len(teams)):
            for second in range(first + 1, len(teams)):
                for i, a in enumerate(teams[first]):
                    if str(a["id"]) in locked:
                        continue
                    for j, b in enumerate(teams[second]):
                        if str(b["id"]) in locked:
                            continue
                        candidate = list(totals)
                        difference = float(a.get("skill", 0)) - float(b.get("skill", 0))
                        candidate[first] -= difference
                        candidate[second] += difference
                        candidate_diff = round(max(candidate) - min(candidate), 9)
                        if candidate_diff >= best_diff:
                            continue
                        teams[first][i], teams[second][j] = b, a
                        if _attribute_imbalance(teams) <= attribute_score:
                            best, best_diff = (first, second, i, j), candidate_diff
                        teams[first][i], teams[second][j] = a, b
        if best is None:
            return
        first, second, i, j = best
        teams[first][i], teams[second][j] = teams[second][j], teams[first][i]


def assign_teams_snake(
    players: list[dict[str, Any]],
    max_teams: int | None = None,
) -> list[list[dict[str, Any]]]:
    sorted_p = sorted(
        players, key=lambda x: float(x.get("skill", 0)), reverse=True
    )
    teams = _snake_draft(sorted_p, max_teams=max_teams)
    _balance_attributes(teams)
    return teams


def assign_teams_random(
    players: list[dict[str, Any]],
    max_teams: int | None = None,
) -> list[list[dict[str, Any]]]:
    shuffled = list(players)
    random.shuffle(shuffled)
    return _snake_draft(shuffled, max_teams=max_teams)


def rebalance_around_locked(
    players: list[dict[str, Any]],
    lineup: list[list[int]],
    locked: set[int],
    max_teams: int | None = None,
    randomize: bool = False,
    *,
    optimize: bool = False,
    shuffle_equal: bool = True,
) -> list[list[dict[str, Any]]]:
    """Reassign the unlocked players around a lineup with locked spots.

    *lineup* is the current valid partition (user ids per team); only the
    ids in *locked* stay put. The remaining confirmed players are snake-
    drafted by skill (desc), with equal-rated players shuffled among the
    teams on each call — or fully shuffled, when *randomize* — into the
    leftover slots of each team, preserving team sizes.
    """
    by_id = {str(p["id"]): p for p in players}
    locked_str = {str(uid) for uid in locked}
    fixed = [
        [by_id[str(uid)] for uid in team if str(uid) in locked_str and str(uid) in by_id]
        for team in lineup
    ]
    counts = [len(team) for team in lineup]
    fixed_ids = {id(p) for team in fixed for p in team}
    pending = [p for p in players if id(p) not in fixed_ids]
    if randomize:
        random.shuffle(pending)
    else:
        # Skill-desc sort, then shuffle within equal-skill groups: a
        # rebalance must yield a *new* layout, and swapping equal-rated
        # players across teams keeps every team's skill total exactly the
        # same (equal-skill players stay contiguous in the snake, so the
        # per-team bucket counts are unchanged).
        if shuffle_equal:
            pending.sort(key=lambda x: float(x.get("skill", 0)), reverse=True)
        else:
            pending.sort(key=lambda x: (-float(x.get("skill", 0)), str(x["id"])))
        start = 0
        for k in range(1, len(pending) + 1):
            if k == len(pending) or float(pending[k].get("skill", 0)) != float(pending[start].get("skill", 0)):
                if shuffle_equal and k - start > 1:
                    group = pending[start:k]
                    random.shuffle(group)
                    pending[start:k] = group
                start = k

    teams = [list(team) for team in fixed]
    remaining = [max(0, counts[i] - len(teams[i])) for i in range(len(teams))]
    n = len(teams)
    i = 0
    round_idx = 0
    while i < len(pending) and any(r > 0 for r in remaining):
        order = range(n) if round_idx % 2 == 0 else range(n - 1, -1, -1)
        for t in order:
            if i >= len(pending):
                break
            if remaining[t] > 0:
                teams[t].append(pending[i])
                remaining[t] -= 1
                i += 1
        round_idx += 1
    if not randomize:
        _balance_attributes(teams[:max_teams], locked_str)
        if optimize:
            _balance_skill(teams[:max_teams], locked_str)
    return teams
