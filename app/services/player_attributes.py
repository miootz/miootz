"""Automatic player attributes from completed matches with usable evidence."""

from collections import Counter, defaultdict
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.json_column import loads_int_list
from app.models.match import MatchSubstitution, MeetupMatch
from app.models.match_goal import MatchGoal
from app.models.meetup import Meetup
from app.models.user import User
from app.services.rating_windows import meetup_end_time, utc_now


def pace_and_dribbling(user: User) -> dict[str, float]:
    return {
        "pac": user.pac if user.pac is not None else 3.0,
        "dri": user.dri if user.dri is not None else 3.0,
    }


def empty_player_attributes() -> dict:
    return {
        "sho": {"score": None, "count": 0, "sample": 0, "meetups": 0},
        "pas": {"score": None, "count": 0, "sample": 0, "meetups": 0, "total_goals": 0},
        "def": {"score": None, "count": 0, "sample": 0, "meetups": 0},
    }


def effective_player_attributes(user: User, evidence: dict | None) -> dict:
    """Apply manual overrides without modifying the recorded match evidence."""
    attributes = evidence.copy() if evidence else empty_player_attributes()
    for key in ("sho", "pas", "def"):
        override = getattr(user, f"{key}_override")
        if override is not None:
            attributes[key] = {**attributes[key], "score": override, "overridden": True}
    return attributes


def _score(rate: float, middle: float, top: float) -> float:
    if rate <= middle:
        value = 1 + 2 * rate / middle
    else:
        value = 3 + 2 * (rate - middle) / (top - middle)
    return round(max(1.0, min(5.0, value)), 1)


async def load_player_attributes(
    db: AsyncSession, *, year: int | None = None
) -> dict[int, dict]:
    """Return attribute scores and raw evidence for each participating player."""
    now = utc_now()
    meetup_query = select(Meetup).where(
        Meetup.skipped.is_(False), Meetup.start_time <= now
    )
    if year is not None:
        meetup_query = meetup_query.where(
            Meetup.start_time >= datetime(year, 1, 1),
            Meetup.start_time <= datetime(year, 12, 31, 23, 59, 59, 999999),
        )
    meetups = {
        meetup.id: meetup
        for meetup in await db.scalars(meetup_query)
        if meetup_end_time(meetup) <= now
    }
    if not meetups:
        return {}

    matches = list(
        await db.scalars(
            select(MeetupMatch).where(
                MeetupMatch.meetup_id.in_(meetups), MeetupMatch.status == "completed"
            )
        )
    )
    if not matches:
        return {}

    match_ids = [match.id for match in matches]
    goals_by_match: dict[int, list[MatchGoal]] = defaultdict(list)
    for goal in await db.scalars(
        select(MatchGoal).where(
            MatchGoal.match_id.in_(match_ids), MatchGoal.deleted_at.is_(None)
        )
    ):
        goals_by_match[goal.match_id].append(goal)
    subbed = set(
        await db.scalars(
            select(MatchSubstitution.match_id).where(
                MatchSubstitution.match_id.in_(match_ids),
                MatchSubstitution.clock_secs.is_not(None),
            )
        )
    )

    return combine_attribute_evidence(
        meetups,
        attribute_evidence_by_meetup(matches, goals_by_match, subbed),
    )


def attribute_evidence_by_meetup(
    matches: list[MeetupMatch], goals_by_match: dict[int, list[MatchGoal]], subbed: set[int]
) -> dict[int, dict]:
    """Unweighted match evidence, reusable across scopes and as-of dates."""
    evidence: dict[int, dict] = defaultdict(dict)
    for match in matches:
        if match.id in subbed:
            continue
        goals = goals_by_match.get(match.id, [])
        totals = Counter(goal.team for goal in goals)
        reconciled = (
            totals["a"] == match.score_a
            and totals["b"] == match.score_b
            and len(goals) == match.score_a + match.score_b
        )
        for side in ("a", "b"):
            roster = set(
                loads_int_list(
                    match.team_a_users if side == "a" else match.team_b_users
                )
            )
            conceded = match.score_b if side == "a" else match.score_a
            open_play = [
                goal
                for goal in goals
                if goal.team == side and not goal.is_own_goal and not goal.is_penalty
            ]
            scorers = Counter(goal.scorer_id for goal in open_play)
            assisters = Counter(
                goal.assist_id for goal in open_play if goal.assist_id is not None
            )
            known_goals = sum(assisters.values())
            for user_id in roster:
                attrs = evidence[match.meetup_id].setdefault(str(user_id), empty_player_attributes())
                defence = attrs["def"]
                defence["sample"] += 1
                defence["count"] += int(conceded == 0)
                if not reconciled:
                    continue
                shooting = attrs["sho"]
                shooting["sample"] += 1
                shooting["count"] += scorers[user_id]

                passing = attrs["pas"]
                passing["sample"] += known_goals
                passing["count"] += assisters[user_id]
                passing["total_goals"] += len(open_play)

    return evidence


def combine_attribute_evidence(meetups: dict[int, Meetup], evidence: dict[int, dict]) -> dict[int, dict]:
    if not meetups:
        return {}
    as_of = max(meetup_end_time(meetup) for meetup in meetups.values())
    result: dict[int, dict] = {}
    weighted = defaultdict(Counter)
    for meetup_id, players in evidence.items():
        age_days = (as_of - meetup_end_time(meetups[meetup_id])).total_seconds() / 86400
        weight = 0.5 ** (age_days / 21)
        pass_weight = 0.5 ** (age_days / 42)
        for user_id, row in players.items():
            uid = int(user_id)
            attrs = result.setdefault(uid, empty_player_attributes())
            weights = weighted[uid]
            for key, unit_weight in (("sho", weight), ("pas", pass_weight), ("def", weight)):
                evidence_row = row[key]
                for field in ("sample", "count"):
                    attrs[key][field] += evidence_row[field]
                    weights[f"{key}_{field}"] += unit_weight * evidence_row[field]
                attrs[key]["meetups"] += int(evidence_row["sample"] > 0)
            attrs["pas"]["total_goals"] += row["pas"]["total_goals"]

    for user_id, attrs in result.items():
        weights = weighted[user_id]
        sho, pas, defence = attrs["sho"], attrs["pas"], attrs["def"]
        if sho["sample"] >= 8 and sho["meetups"] >= 3:
            sho["score"] = _score(
                (weights["sho_count"] + 1.2) / (weights["sho_sample"] + 4), 0.30, 0.85
            )
        if defence["sample"] >= 8 and defence["meetups"] >= 3:
            defence["score"] = _score(
                (weights["def_count"] + 2) / (weights["def_sample"] + 8), 0.25, 0.70
            )
        if (
            pas["sample"] >= 8
            and pas["meetups"] >= 3
            and 2 * pas["sample"] >= pas["total_goals"]
        ):
            pas["score"] = _score(
                (weights["pas_count"] + 3) / (weights["pas_sample"] + 15), 0.20, 0.45
            )
    return result
