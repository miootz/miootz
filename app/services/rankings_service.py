"""Season / meetup rankings.

One row per player with every metric column; a season is a naive-UTC calendar
year (stats_service convention) — "reset on January 1st" is a query-time
filter, never a data migration. Players with 0 confirmed attendance in the
selected scope are excluded from rankings.
"""

from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import MeetupMatch
from app.models.match_goal import MatchGoal
from app.models.meetup import Attendance, Meetup
from app.models.user import User

SORTABLE_COLUMNS = (
    "attendances",
    "goals",
    "assists",
    "clean_sheets",
    "goals_conceded",
)


def _year_bounds(year: int) -> tuple[datetime, datetime]:
    return datetime(year, 1, 1), datetime(year, 12, 31, 23, 59, 59, 999999)


async def _load_scope(
    db: AsyncSession,
    bounds: tuple[datetime, datetime] | None,
    meetup_id: int | None = None,
) -> tuple[dict[int, int], list[MeetupMatch], list[MatchGoal]]:
    """Confirmed-attendance counts, completed matches and live goals for the scope."""
    att_q = (
        select(Attendance.user_id, func.count(Attendance.id))
        .join(Meetup, Meetup.id == Attendance.meetup_id)
        .where(Attendance.status == "confirmed")
        .group_by(Attendance.user_id)
    )
    if meetup_id is not None:
        att_q = att_q.where(Attendance.meetup_id == meetup_id)
    if bounds:
        att_q = att_q.where(Meetup.start_time >= bounds[0], Meetup.start_time <= bounds[1])
    attendances = {uid: n for uid, n in (await db.execute(att_q)).all()}

    match_q = select(MeetupMatch).where(MeetupMatch.status == "completed")
    if meetup_id is not None:
        match_q = match_q.where(MeetupMatch.meetup_id == meetup_id)
    if bounds:
        match_q = match_q.where(MeetupMatch.completed_at >= bounds[0], MeetupMatch.completed_at <= bounds[1])
    matches = list((await db.execute(match_q)).scalars().all())

    goals: list[MatchGoal] = []
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
    return attendances, matches, goals


def _aggregate(
    attendances: dict[int, int],
    matches: list[MeetupMatch],
    goals: list[MatchGoal],
    include_own_goals: bool,
) -> dict[int, dict[str, int]]:
    """Per-user metrics. Strict crediting: only explicitly mentioned players."""
    stats: dict[int, dict[str, int]] = {
        uid: {"attendances": n, "goals": 0, "assists": 0, "clean_sheets": 0, "goals_conceded": 0}
        for uid, n in attendances.items()
    }
    for g in goals:
        if g.is_own_goal and not include_own_goals:
            continue
        s = stats.setdefault(
            g.scorer_id,
            {"attendances": 0, "goals": 0, "assists": 0, "clean_sheets": 0, "goals_conceded": 0},
        )
        s["goals"] += 1
        if g.assist_id is not None:
            stats.setdefault(g.assist_id, {"attendances": 0, "goals": 0, "assists": 0, "clean_sheets": 0, "goals_conceded": 0})[
                "assists"
            ] += 1
        if g.goalkeeper_id is not None:
            stats.setdefault(g.goalkeeper_id, {"attendances": 0, "goals": 0, "assists": 0, "clean_sheets": 0, "goals_conceded": 0})[
                "goals_conceded"
            ] += 1
    # Clean sheet: zero goals against a team in a completed match — credited
    # to the whole roster, not just the keeper.
    for m in matches:
        for roster_json, conceded in ((m.team_a_users, m.score_b), (m.team_b_users, m.score_a)):
            if conceded:
                continue
            for uid in json.loads(roster_json or "[]"):
                stats.setdefault(uid, {"attendances": 0, "goals": 0, "assists": 0, "clean_sheets": 0, "goals_conceded": 0})[
                    "clean_sheets"
                ] += 1
    return stats


async def _rows_for_users(
    db: AsyncSession, stats: dict[int, dict[str, int]]
) -> list[dict]:
    if not stats:
        return []
    users = list(
        (
            await db.execute(select(User).where(User.id.in_(list(stats))))
        ).scalars().all()
    )
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
            }
        )
    return rows


def _sort_rows(rows: list[dict], sort: str, order: str) -> list[dict]:
    reverse = order == "desc"
    rows.sort(key=lambda r: r["user"]["display_name"])
    # Deterministic tie-break chain under the selected primary column.
    rows.sort(key=lambda r: r["clean_sheets"], reverse=True)
    rows.sort(key=lambda r: r["assists"], reverse=True)
    rows.sort(key=lambda r: r["goals"], reverse=True)
    rows.sort(key=lambda r: r[sort], reverse=reverse)
    return rows


async def _available_years(db: AsyncSession) -> list[int]:
    res = await db.execute(
        select(func.strftime("%Y", Meetup.start_time))
        .join(Attendance, Attendance.meetup_id == Meetup.id)
        .where(Attendance.status == "confirmed")
        .distinct()
    )
    return sorted({int(y) for y in res.scalars() if y})


def _envelope(
    *,
    year: int | None,
    available_years: list[int] | None,
    rows: list[dict],
    page: int = 1,
    per_page: int = 25,
    total: int | None = None,
) -> dict:
    total = len(rows) if total is None else total
    start = (page - 1) * per_page
    return {
        "year": year,
        "available_years": available_years,
        "page": page,
        "per_page": per_page,
        "total": total,
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
    attendances, matches, goals = await _load_scope(db, bounds)
    stats = _aggregate(attendances, matches, goals, include_own_goals)
    # Players with 0 attendance in scope never appear in the tables.
    stats = {uid: s for uid, s in stats.items() if attendances.get(uid, 0) > 0}
    rows = _sort_rows(await _rows_for_users(db, stats), sort, order)
    return _envelope(
        year=year,
        available_years=await _available_years(db),
        rows=rows,
        page=page,
        per_page=per_page,
    )


async def get_meetup_rankings(db: AsyncSession, meetup_id: int) -> dict | None:
    """Per-meetup rankings for the history page; None when there is nothing to rank."""
    attendances, matches, goals = await _load_scope(db, None, meetup_id=meetup_id)
    if not matches:
        return None
    stats = _aggregate(attendances, matches, goals, include_own_goals=True)
    stats = {uid: s for uid, s in stats.items() if attendances.get(uid, 0) > 0}
    rows = _sort_rows(await _rows_for_users(db, stats), "goals", "desc")
    return _envelope(year=None, available_years=None, rows=rows)


async def get_user_metrics(
    db: AsyncSession,
    user_id: int,
    *,
    year: int | None = None,
    include_own_goals: bool = False,
) -> dict[str, int]:
    """One user's scoped metrics (all zeros when they have no activity)."""
    bounds = _year_bounds(year) if year else None
    attendances, matches, goals = await _load_scope(db, bounds)
    stats = _aggregate(attendances, matches, goals, include_own_goals)
    return stats.get(
        user_id,
        {"attendances": 0, "goals": 0, "assists": 0, "clean_sheets": 0, "goals_conceded": 0},
    )
