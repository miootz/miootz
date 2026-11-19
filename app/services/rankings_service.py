"""Season / meetup rankings.

One row per player with every metric column; a season is a naive-UTC calendar
year (stats_service convention) — "reset on January 1st" is a query-time
filter, never a data migration. Players with 0 confirmed attendance in the
selected scope are excluded from rankings.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import MatchPenalty, MatchSubstitution, MeetupMatch
from app.models.match_goal import MatchGoal
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.services.rating_settings import get_rating_settings, selected_rating

METRIC_KEYS = (
    "attendances",
    "goals",
    "assists",
    "clean_sheets",
    "goals_conceded",
    "wins",
    "matches",
)

SORTABLE_COLUMNS = (
    *METRIC_KEYS,
    "losses",
    "own_goals",
    "win_rate",
    "goal_assists",
    "goals_per_match",
    "assists_per_match",
    "goal_assists_per_match",
    "penalties_taken",
    "penalties_scored",
    "penalty_conversion_rate",
)


def _zero() -> dict[str, int]:
    return {k: 0 for k in METRIC_KEYS}


def _match_winner_side(match: MeetupMatch) -> str:
    """De-facto winner: a decided shootout overrides the score rule
    (a tie goes to the away team)."""
    if match.penalty_winner is not None:
        return match.penalty_winner
    return "a" if match.score_a > match.score_b else "b"


def _eligible_players(
    match: MeetupMatch, subs: list[MatchSubstitution]
) -> set[int] | None:
    """Users on the pitch for ≥50% of the match's elapsed clock.

    None when the match has no clocked mid-match subs — then every roster
    member is credited, exactly as before substitutions existed.
    """
    clocked = sorted(
        (s for s in subs if s.clock_secs is not None), key=lambda s: (s.clock_secs, s.id)
    )
    if not clocked:
        return None
    elapsed = match.timer_total_seconds - (match.timer_seconds_remaining or 0)
    if elapsed <= 0:
        return None
    # First clocked row's "old" state is the starting lineup (pre-start
    # swaps are pending-only and carry no clock).
    first = clocked[0]
    on_at: dict[int, int] = {
        uid: 0 for uid in json.loads(first.old_team_a_users) + json.loads(first.old_team_b_users)
    }
    on_pitch: dict[int, int] = {}
    for s in clocked:
        old = set(json.loads(s.old_team_a_users)) | set(json.loads(s.old_team_b_users))
        new = set(json.loads(s.new_team_a_users)) | set(json.loads(s.new_team_b_users))
        for uid in old - new:
            on_pitch[uid] = on_pitch.get(uid, 0) + s.clock_secs - on_at.pop(uid)
        for uid in new - old:
            on_at[uid] = s.clock_secs
    for uid, t in on_at.items():
        on_pitch[uid] = on_pitch.get(uid, 0) + elapsed - t
    return {uid for uid, secs in on_pitch.items() if secs * 2 >= elapsed}


def _year_bounds(year: int) -> tuple[datetime, datetime]:
    return datetime(year, 1, 1), datetime(year, 12, 31, 23, 59, 59, 999999)


async def _load_scope(
    db: AsyncSession,
    bounds: tuple[datetime, datetime] | None,
    meetup_id: int | None = None,
    meetup_ids: list[int] | None = None,
) -> tuple[dict[int, int], list[MeetupMatch], list[MatchGoal], list[MatchSubstitution]]:
    """Confirmed-attendance counts, completed matches, live goals and
    substitutions for the scope."""
    att_q = (
        select(Attendance.user_id, func.count(Attendance.id))
        .join(Meetup, Meetup.id == Attendance.meetup_id)
        .where(Attendance.status == "confirmed")
        .group_by(Attendance.user_id)
    )
    if meetup_id is not None:
        att_q = att_q.where(Attendance.meetup_id == meetup_id)
    if meetup_ids:
        att_q = att_q.where(Attendance.meetup_id.in_(meetup_ids))
    if bounds:
        att_q = att_q.where(Meetup.start_time >= bounds[0], Meetup.start_time <= bounds[1])
    attendances = {uid: n for uid, n in (await db.execute(att_q)).all()}

    match_q = select(MeetupMatch).where(MeetupMatch.status == "completed")
    if meetup_id is not None:
        match_q = match_q.where(MeetupMatch.meetup_id == meetup_id)
    if meetup_ids:
        match_q = match_q.where(MeetupMatch.meetup_id.in_(meetup_ids))
    if bounds:
        match_q = match_q.where(MeetupMatch.completed_at >= bounds[0], MeetupMatch.completed_at <= bounds[1])
    matches = list((await db.execute(match_q)).scalars().all())

    goals: list[MatchGoal] = []
    subs: list[MatchSubstitution] = []
    if matches:
        goals = list(
            (
                await db.execute(
                    select(MatchGoal).where(
                        MatchGoal.match_id.in_([m.id for m in matches]),
                        MatchGoal.deleted_at.is_(None),
                    )
                )
            ).scalars().all()
        )
        subs = list(
            (
                await db.execute(
                    select(MatchSubstitution).where(
                        MatchSubstitution.match_id.in_([m.id for m in matches])
                    )
                )
            ).scalars().all()
        )
    return attendances, matches, goals, subs


def _aggregate(
    attendances: dict[int, int],
    matches: list[MeetupMatch],
    goals: list[MatchGoal],
    include_own_goals: bool,
    subs: list[MatchSubstitution] | None = None,
) -> dict[int, dict[str, int]]:
    """Per-user metrics. Strict crediting: only explicitly mentioned players.

    Wins follow the de-facto winner: a decided shootout's winner, else
    score_a > score_b → team A, else team B (a tie goes to the away team).
    ``was_draw`` is statistics information only and never changes crediting.
    With mid-match subs, only players on the pitch ≥50% of the match count.
    """
    subs = subs or []
    subs_by_match: dict[int, list[MatchSubstitution]] = {}
    for s in subs:
        subs_by_match.setdefault(s.match_id, []).append(s)
    stats: dict[int, dict[str, int]] = {
        uid: {**_zero(), "attendances": n} for uid, n in attendances.items()
    }
    for g in goals:
        if g.is_own_goal and not include_own_goals:
            continue
        stats.setdefault(g.scorer_id, _zero())["goals"] += 1
        if g.assist_id is not None:
            stats.setdefault(g.assist_id, _zero())["assists"] += 1
        if g.goalkeeper_id is not None:
            stats.setdefault(g.goalkeeper_id, _zero())["goals_conceded"] += 1
    # Per match: matches played, wins (de-facto winner) and clean sheets
    # (zero goals against a team — credited to the whole roster, not just
    # the keeper).
    winner_side = {m.id: _match_winner_side(m) for m in matches}
    for m in matches:
        eligible = _eligible_players(m, subs_by_match.get(m.id, []))
        for side in ("a", "b"):
            roster = json.loads((m.team_a_users if side == "a" else m.team_b_users) or "[]")
            conceded = m.score_b if side == "a" else m.score_a
            is_winner = winner_side[m.id] == side
            for uid in roster:
                if eligible is not None and uid not in eligible:
                    continue
                s = stats.setdefault(uid, _zero())
                s["matches"] += 1
                if is_winner:
                    s["wins"] += 1
                if not conceded:
                    s["clean_sheets"] += 1
    return stats


async def rank_player_metrics(
    db: AsyncSession,
    attendances: dict[int, int],
    matches: list[MeetupMatch],
    goals: list[MatchGoal],
    subs: list[MatchSubstitution],
    *,
    include_own_goals: bool = False,
) -> dict[int, dict[str, int | float]]:
    """Complete ranking metrics, also used to reconcile historical imports."""
    stats = _aggregate(attendances, matches, goals, include_own_goals, subs)
    own_goals = Counter(goal.scorer_id for goal in goals if goal.is_own_goal)
    penalties_scored = Counter(
        goal.scorer_id for goal in goals if goal.is_penalty and not goal.is_own_goal
    )
    penalties_taken = penalties_scored.copy()
    if matches:
        kicks = await db.execute(
            select(MatchPenalty.scorer_id, MatchPenalty.scored)
            .where(MatchPenalty.match_id.in_([match.id for match in matches]))
        )
        for scorer_id, scored in kicks:
            penalties_taken[scorer_id] += 1
            penalties_scored[scorer_id] += int(scored)

    result = {}
    for uid, metrics in stats.items():
        played = metrics["matches"]
        goals_and_assists = metrics["goals"] + metrics["assists"]
        taken = penalties_taken[uid]
        result[uid] = {
            **metrics,
            "losses": played - metrics["wins"],
            "own_goals": own_goals[uid],
            "win_rate": metrics["wins"] / played if played else 0.0,
            "goal_assists": goals_and_assists,
            "goals_per_match": metrics["goals"] / played if played else 0.0,
            "assists_per_match": metrics["assists"] / played if played else 0.0,
            "goal_assists_per_match": goals_and_assists / played if played else 0.0,
            "penalties_taken": taken,
            "penalties_scored": penalties_scored[uid],
            "penalty_conversion_rate": penalties_scored[uid] / taken if taken else 0.0,
        }
    return result


async def _rows_for_users(
    db: AsyncSession, stats: dict[int, dict[str, int | float]]
) -> list[dict]:
    if not stats:
        return []
    users = list(
        (
            await db.execute(select(User).where(User.id.in_(list(stats))))
        ).scalars().all()
    )
    computed_scores = (await get_rating_settings(db)).computed_scores
    rows = []
    for user in users:
        metrics = stats[user.id]
        rows.append(
            {
                "user": {
                    "id": user.id,
                    "display_name": user.display_name,
                    "avatar_url": user.avatar_url,
                },
                **metrics,
                "rating": selected_rating(user, computed_scores),
                "win_rate": round(metrics["win_rate"], 3),
            }
        )
    return rows


def descending_score(value: int | float | None) -> float:
    return -value if value is not None else float("inf")


def _sort_rows(rows: list[dict], sort: str, order: str) -> list[dict]:
    direction = -1 if order == "desc" else 1
    rows.sort(key=lambda r: (
        direction * r[sort],
        descending_score(r["rating"]),
        r["user"]["display_name"].casefold(),
        r["user"]["id"],
    ))
    return rows


async def _available_years(db: AsyncSession) -> list[int]:
    res = await db.execute(
        select(func.strftime("%Y", Meetup.start_time))
        .join(Attendance, Attendance.meetup_id == Meetup.id)
        .where(Attendance.status == "confirmed")
        .distinct()
    )
    return sorted({int(y) for y in res.scalars() if y})


def _highlights(rows: list[dict]) -> dict[str, list[dict]]:
    """Top-3 per category over the full in-scope row set."""

    def top(key: str, fmt, min_matches: int = 0) -> list[dict]:
        eligible = [r for r in rows if r["matches"] >= min_matches]
        ordered = _sort_rows(eligible, key, "desc")
        return [
            {
                "user_id": r["user"]["id"],
                "name": r["user"]["display_name"],
                "value": fmt(r),
            }
            for r in ordered[:3]
        ]

    return {
        "goals": top("goals", lambda r: r["goals"]),
        "assists": top("assists", lambda r: r["assists"]),
        "goal_assists": top("goal_assists", lambda r: r["goal_assists"]),
        "goal_assists_per_match": top(
            "goal_assists_per_match", lambda r: r["goal_assists_per_match"], min_matches=2
        ),
        "wins": top("wins", lambda r: f'{r["wins"]} of {r["matches"]}'),
        "matches": top("matches", lambda r: r["matches"]),
        "win_rate": top(
            "win_rate", lambda r: f"{round(r['win_rate'] * 100)}%", min_matches=2
        ),
        "attendances": top("attendances", lambda r: r["attendances"]),
    }


async def _night_block(
    db: AsyncSession,
    matches: list[MeetupMatch],
    goals: list[MatchGoal],
) -> dict:
    """Per-meetup night stats: KPIs + one record per team name."""
    teams: dict[str, dict] = {}
    all_player_ids: set[int] = set()
    for m in matches:
        for side in ("a", "b"):
            name = m.team_a_name if side == "a" else m.team_b_name
            roster = json.loads((m.team_a_users if side == "a" else m.team_b_users) or "[]")
            gf = m.score_a if side == "a" else m.score_b
            ga = m.score_b if side == "a" else m.score_a
            is_winner = _match_winner_side(m) == side
            rec = teams.setdefault(
                name,
                {"wins": 0, "matches": 0, "goals_for": 0, "goals_against": 0,
                 "clean_sheets": 0, "_ids": set()},
            )
            rec["matches"] += 1
            rec["goals_for"] += gf
            rec["goals_against"] += ga
            if is_winner:
                rec["wins"] += 1
            if not ga:
                rec["clean_sheets"] += 1
            rec["_ids"].update(roster)
            all_player_ids.update(roster)
    db_users = await _display_names(db, all_player_ids)
    team_rows = []
    for name, rec in teams.items():
        ids = sorted(rec.pop("_ids"))
        team_rows.append(
            {
                "name": name,
                "goal_diff": rec["goals_for"] - rec["goals_against"],
                "roster": [
                    {"id": uid, "display_name": db_users.get(uid, f"User {uid}")}
                    for uid in ids
                ],
                **rec,
            }
        )
    team_rows.sort(key=lambda t: (-t["wins"], -t["goal_diff"], t["name"]))
    draw_matches = [
        {
            "team_a": m.team_a_name,
            "score_a": m.score_a,
            "team_b": m.team_b_name,
            "score_b": m.score_b,
            # A recorded draw always sends the away side to the next match.
            "advancer": m.team_b_name,
        }
        for m in sorted(matches, key=lambda m: m.match_number)
        if m.was_draw
    ]
    return {
        "kpis": {
            "matches": len(matches),
            "goals": len(goals),
            "players": len(all_player_ids),
            "draws": sum(1 for m in matches if m.was_draw),
        },
        "teams": team_rows,
        "draw_matches": draw_matches,
    }


async def _display_names(db: AsyncSession, user_ids: set[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    users = (
        (
            await db.execute(select(User).where(User.id.in_(list(user_ids))))
        ).scalars().all()
    )
    return {u.id: u.display_name for u in users}


def _envelope(
    *,
    year: int | None,
    available_years: list[int] | None,
    rows: list[dict],
    page: int = 1,
    per_page: int = 25,
    total: int | None = None,
    night: dict | None = None,
    highlights: dict | None = None,
) -> dict:
    total = len(rows) if total is None else total
    start = (page - 1) * per_page
    return {
        "year": year,
        "available_years": available_years,
        "page": page,
        "per_page": per_page,
        "total": total,
        "night": night,
        "highlights": highlights,
        "rows": [
            {**row, "rank": start + i + 1} for i, row in enumerate(rows[start : start + per_page])
        ],
    }


async def get_rankings(
    db: AsyncSession,
    *,
    year: int | None = None,
    include_own_goals: bool = False,
    sort: str = "attendances",
    order: str = "desc",
    page: int = 1,
    per_page: int = 25,
) -> dict:
    """Season (year) or all-time (year=None) rankings, one row per player."""
    if sort not in SORTABLE_COLUMNS:
        sort = "attendances"
    order = order if order in ("asc", "desc") else "desc"
    bounds = _year_bounds(year) if year else None
    attendances, matches, goals, subs = await _load_scope(db, bounds)
    stats = await rank_player_metrics(
        db, attendances, matches, goals, subs, include_own_goals=include_own_goals
    )
    # Players with 0 attendance in scope never appear in the tables.
    stats = {uid: s for uid, s in stats.items() if attendances.get(uid, 0) > 0}
    rows = _sort_rows(await _rows_for_users(db, stats), sort, order)
    return _envelope(
        year=year,
        available_years=await _available_years(db),
        rows=rows,
        page=page,
        per_page=per_page,
        highlights=_highlights(rows),
    )


async def get_meetup_rankings(db: AsyncSession, meetup_id: int) -> dict | None:
    """Per-meetup rankings + night block; None when there is nothing to rank."""
    attendances, matches, goals, subs = await _load_scope(db, None, meetup_id=meetup_id)
    if not matches:
        return None
    stats = await rank_player_metrics(
        db, attendances, matches, goals, subs, include_own_goals=True
    )
    stats = {uid: s for uid, s in stats.items() if attendances.get(uid, 0) > 0}
    rows = _sort_rows(await _rows_for_users(db, stats), "goals", "desc")
    night = await _night_block(db, matches, goals)
    return _envelope(year=None, available_years=None, rows=rows, night=night, per_page=max(1, len(rows)))


async def get_user_metrics(
    db: AsyncSession,
    user_id: int,
    *,
    year: int | None = None,
    include_own_goals: bool = False,
    include_ranked_metrics: bool = False,
) -> dict[str, int | float]:
    """One user's scoped metrics (all zeros when they have no activity)."""
    bounds = _year_bounds(year) if year else None
    attendances, matches, goals, subs = await _load_scope(db, bounds)
    if include_ranked_metrics:
        stats = await rank_player_metrics(
            db, attendances, matches, goals, subs, include_own_goals=include_own_goals
        )
    else:
        stats = _aggregate(attendances, matches, goals, include_own_goals, subs)
    return stats.get(user_id, _zero())


async def get_user_meetup_metrics(
    db: AsyncSession,
    user_id: int,
    meetup_ids: list[int],
) -> dict[int, dict[str, int]]:
    """Per-meetup metrics for one user, in one batch (own goals included)."""
    if not meetup_ids:
        return {}
    attendances, matches, goals, subs = await _load_scope(db, None, meetup_ids=list(meetup_ids))
    out: dict[int, dict[str, int]] = {}
    ids_by_meetup: dict[int, set[int]] = {}
    subs_by_match: dict[int, list[MatchSubstitution]] = {}
    for m in matches:
        ids_by_meetup.setdefault(m.meetup_id, set()).add(m.id)
    for s in subs:
        subs_by_match.setdefault(s.match_id, []).append(s)
    for mid in meetup_ids:
        mids = ids_by_meetup.get(mid)
        if not mids:
            out[mid] = _zero()
            continue
        ms = [m for m in matches if m.id in mids]
        gs = [g for g in goals if g.match_id in mids]
        msubs = [s for m in ms for s in subs_by_match.get(m.id, [])]
        out[mid] = _aggregate(attendances, ms, gs, include_own_goals=True, subs=msubs).get(
            user_id, _zero()
        )
    return out
