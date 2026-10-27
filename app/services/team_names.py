"""Random team name generation for meetups."""

from __future__ import annotations

import random
from typing import Final

#: Pool of fun football-themed team names.
_TEAM_NAME_POOL: Final[list[str]] = [
    "Red Devils",
    "Blue Stars",
    "Golden Boot",
    "Iron Leg",
    "Thunder FC",
    "Lightning United",
    "Phoenix Rising",
    "Eagles Soar",
    "Crimson Tide",
    "Silver Arrows",
    "Wildcats",
    "Panthers",
    "Raptors",
    "Hawks",
    "Vipers",
    "Cobras",
    "Tigers",
    "Lions",
    "Sharks",
    "Wolves",
    "Galacticos",
    "Night Owls",
    "Fire Storm",
    "Ice Breakers",
    "Diamondbacks",
    "Steel City",
    "Rough Riders",
    "Storm Chasers",
    "Blaze",
    "Vendetta",
    "Renegades",
    "Warriors",
    "Gladiators",
    "Spartans",
    "Crusaders",
    "Titans",
    "Vikings",
    "Samurai",
    "Ninjas",
    "Phantoms",
    "Spectres",
    "Rebels",
    "Outlaws",
    "Bandits",
    "Corsairs",
    "Marauders",
    "Conquerors",
    "Legion",
    "Dynasty",
]


def generate_team_names(count: int = 2) -> list[str]:
    """Pick *count* unique random team names from the pool.

    Falls back to sequential indexing if the pool is exhausted.
    """
    count = max(1, min(count, len(_TEAM_NAME_POOL)))
    return random.sample(_TEAM_NAME_POOL, count)
