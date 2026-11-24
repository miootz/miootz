"""Sequential team names for meetups."""

from __future__ import annotations


def team_name(index: int) -> str:
    """1-based sequential name: Team A, Team B, ..., Team Z, Team AA, ..."""
    n = index
    label = ""
    while n > 0:
        n, remainder = divmod(n - 1, 26)
        label = chr(ord("A") + remainder) + label
    return f"Team {label}"


def generate_team_names(count: int = 2) -> list[str]:
    """Return *count* sequential team names: Team A, Team B, ..."""
    return [team_name(i) for i in range(1, max(1, count) + 1)]
