"""Determine teammates from completed match lineups and substitutions."""

from collections.abc import Collection
from itertools import combinations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.json_column import loads_int_list
from app.models.match import MatchSubstitution, MeetupMatch


async def teammate_pairs(
    db: AsyncSession, meetup_ids: Collection[int]
) -> dict[int, set[tuple[int, int]]]:
    """Return pairs who played for the same side of a completed match."""
    pairs: dict[int, set[tuple[int, int]]] = {
        meetup_id: set() for meetup_id in meetup_ids
    }
    if not pairs:
        return pairs

    matches = list(
        await db.scalars(
            select(MeetupMatch).where(
                MeetupMatch.meetup_id.in_(pairs),
                MeetupMatch.status == "completed",
            )
        )
    )
    if not matches:
        return pairs

    substitutions: dict[int, list[MatchSubstitution]] = {}
    for sub in await db.scalars(
        select(MatchSubstitution).where(
            MatchSubstitution.match_id.in_([match.id for match in matches]),
            MatchSubstitution.clock_secs.is_not(None),
        )
    ):
        substitutions.setdefault(sub.match_id, []).append(sub)

    for match in matches:
        for side in ("a", "b"):
            players = set(loads_int_list(getattr(match, f"team_{side}_users")))
            for sub in substitutions.get(match.id, []):
                players.update(loads_int_list(getattr(sub, f"old_team_{side}_users")))
                players.update(loads_int_list(getattr(sub, f"new_team_{side}_users")))
            pairs[match.meetup_id].update(combinations(sorted(players), 2))
    return pairs
