"""Season / meetup rankings.

One row per player with every metric column; a season is a naive-UTC calendar
year (stats_service convention) — "reset on January 1st" is a query-time
filter, never a data migration. Players with 0 confirmed attendance in the
selected scope are excluded from rankings.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime

from sqlalchemy import func, select, text, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import MatchPenalty, MatchSubstitution, MeetupMatch, PenaltyMiss
from app.models.match_goal import MatchGoal
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.models.meetup_analytics import MeetupAnalytics
from app.services.rating_windows import meetup_end_time, utc_now
from app.services.player_attributes import (
    attribute_evidence_by_meetup,
    combine_attribute_evidence,
)
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
        (s for s in subs if s.clock_secs is not None),
        key=lambda s: (s.clock_secs, s.id),
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
        uid: 0
        for uid in json.loads(first.old_team_a_users)
        + json.loads(first.old_team_b_users)
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
        att_q = att_q.where(
            Meetup.start_time >= bounds[0], Meetup.start_time <= bounds[1]
        )
    attendances = {uid: n for uid, n in (await db.execute(att_q)).all()}

    match_q = select(MeetupMatch).where(MeetupMatch.status == "completed")
    if meetup_id is not None:
        match_q = match_q.where(MeetupMatch.meetup_id == meetup_id)
    if meetup_ids:
        match_q = match_q.where(MeetupMatch.meetup_id.in_(meetup_ids))
    if bounds:
        match_q = match_q.where(
            MeetupMatch.completed_at >= bounds[0], MeetupMatch.completed_at <= bounds[1]
        )
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
            )
            .scalars()
            .all()
        )
        subs = list(
            (
                await db.execute(
                    select(MatchSubstitution).where(
                        MatchSubstitution.match_id.in_([m.id for m in matches])
                    )
                )
            )
            .scalars()
            .all()
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
        if not g.is_penalty:
            # Penalty goals count toward the score but not the player's goals
            # ranking — the keeper still gets the conceded goal.
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
            roster = json.loads(
                (m.team_a_users if side == "a" else m.team_b_users) or "[]"
            )
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
    kicks = await _load_kicks(db, matches)
    misses = await _load_misses(db, matches)
    return _rank_metrics(
        attendances, matches, goals, subs, kicks, misses, include_own_goals
    )


async def _load_kicks(db: AsyncSession, matches: list[MeetupMatch]) -> list:
    if not matches:
        return []
    return list(
        await db.execute(
            select(
                MatchPenalty.match_id, MatchPenalty.scorer_id, MatchPenalty.scored
            ).where(MatchPenalty.match_id.in_([match.id for match in matches]))
        )
    )


async def _load_misses(db: AsyncSession, matches: list[MeetupMatch]) -> list:
    if not matches:
        return []
    return list(
        await db.execute(
            select(PenaltyMiss.match_id, PenaltyMiss.scorer_id).where(
                PenaltyMiss.match_id.in_([match.id for match in matches])
            )
        )
    )


def _rank_metrics(
    attendances,
    matches,
    goals,
    subs,
    kicks,
    misses,
    include_own_goals,
    *,
    keep_unranked_counts=False,
) -> dict[int, dict[str, int | float]]:
    stats = _aggregate(attendances, matches, goals, include_own_goals, subs)
    own_goals = Counter(goal.scorer_id for goal in goals if goal.is_own_goal)
    penalties_scored = Counter(
        goal.scorer_id for goal in goals if goal.is_penalty and not goal.is_own_goal
    )
    penalties_taken = penalties_scored.copy()
    for _, scorer_id, scored in kicks:
        penalties_taken[scorer_id] += 1
        penalties_scored[scorer_id] += int(scored)
    for _, scorer_id in misses:
        penalties_taken[scorer_id] += 1

    if keep_unranked_counts:
        # A player may qualify for a season ranking through a different meetup.
        for uid in own_goals.keys() | penalties_taken.keys():
            stats.setdefault(uid, _zero())
    return {
        uid: _with_rates(
            {
                **metrics,
                "own_goals": own_goals[uid],
                "penalties_taken": penalties_taken[uid],
                "penalties_scored": penalties_scored[uid],
            }
        )
        for uid, metrics in stats.items()
    }


COUNT_KEYS = (*METRIC_KEYS, "own_goals", "penalties_taken", "penalties_scored")
ANALYTICS_VERSION = (
    2  # penalty goals excluded from goals ranking; misses count toward penalties_taken
)


def _with_rates(metrics: dict) -> dict[str, int | float]:
    played = metrics["matches"]
    goals_and_assists = metrics["goals"] + metrics["assists"]
    taken = metrics["penalties_taken"]
    return {
        **metrics,
        "losses": played - metrics["wins"],
        "win_rate": metrics["wins"] / played if played else 0.0,
        "goal_assists": goals_and_assists,
        "goals_per_match": metrics["goals"] / played if played else 0.0,
        "assists_per_match": metrics["assists"] / played if played else 0.0,
        "goal_assists_per_match": goals_and_assists / played if played else 0.0,
        "penalty_conversion_rate": metrics["penalties_scored"] / taken
        if taken
        else 0.0,
    }


def _counts_for_scope(
    attendances, matches, goals, subs, kicks, misses, include_own_goals
) -> dict[str, dict]:
    rows = _rank_metrics(
        attendances,
        matches,
        goals,
        subs,
        kicks,
        misses,
        include_own_goals,
        keep_unranked_counts=True,
    )
    return {
        str(uid): {key: row[key] for key in COUNT_KEYS} for uid, row in rows.items()
    }


async def _build_analytics(db: AsyncSession, meetups: list[Meetup]) -> dict[int, dict]:
    ids = [meetup.id for meetup in meetups]
    if not ids:
        return {}
    _, matches, goals, subs = await _load_scope(db, None, meetup_ids=ids)
    kicks = await _load_kicks(db, matches)
    misses = await _load_misses(db, matches)
    attendees = defaultdict(Counter)
    for mid, uid, count in await db.execute(
        select(Attendance.meetup_id, Attendance.user_id, func.count(Attendance.id))
        .where(Attendance.meetup_id.in_(ids), Attendance.status == "confirmed")
        .group_by(Attendance.meetup_id, Attendance.user_id)
    ):
        attendees[mid][uid] = count

    matches_by_meetup = defaultdict(list)
    goals_by_match = defaultdict(list)
    subs_by_match = defaultdict(list)
    kicks_by_match = defaultdict(list)
    misses_by_match = defaultdict(list)
    for match in matches:
        matches_by_meetup[match.meetup_id].append(match)
    for goal in goals:
        goals_by_match[goal.match_id].append(goal)
    for sub in subs:
        subs_by_match[sub.match_id].append(sub)
    for kick in kicks:
        kicks_by_match[kick.match_id].append(kick)
    for miss in misses:
        misses_by_match[miss.match_id].append(miss)
    subbed = {sub.match_id for sub in subs if sub.clock_secs is not None}
    evidence = attribute_evidence_by_meetup(matches, goals_by_match, subbed)

    def counts(attendance, scoped_matches):
        scoped_goals = [
            goal for match in scoped_matches for goal in goals_by_match[match.id]
        ]
        scoped_subs = [
            sub for match in scoped_matches for sub in subs_by_match[match.id]
        ]
        scoped_kicks = [
            kick for match in scoped_matches for kick in kicks_by_match[match.id]
        ]
        scoped_misses = [
            miss for match in scoped_matches for miss in misses_by_match[match.id]
        ]
        return [
            _counts_for_scope(
                attendance,
                scoped_matches,
                scoped_goals,
                scoped_subs,
                scoped_kicks,
                scoped_misses,
                own,
            )
            for own in (False, True)
        ]

    data = {}
    for meetup in meetups:
        matches_by_year = defaultdict(list)
        for match in matches_by_meetup[meetup.id]:
            if match.completed_at:
                matches_by_year[match.completed_at.year].append(match)
        start_year = meetup.start_time.year
        attendance = attendees[meetup.id]
        all_counts = counts(attendance, matches_by_meetup[meetup.id])
        # Attendance uses kickoff year. Match credit uses each match's finish year.
        if len(matches_by_year[start_year]) == len(matches_by_meetup[meetup.id]):
            years = {str(start_year): all_counts}
        else:
            years = {
                str(year): counts(
                    attendance if year == start_year else {}, matches_by_year[year]
                )
                for year in matches_by_year
            }
        data[meetup.id] = {
            "all": all_counts,
            "seasons": years,
            "attributes": evidence.get(meetup.id, {}),
        }
    return data


async def load_meetup_analytics(
    db: AsyncSession, meetups: list[Meetup]
) -> dict[int, dict]:
    """Read finished-meetup summaries, repairing only missing/invalidated rows."""
    if not meetups:
        return {}
    ids = [meetup.id for meetup in meetups]
    snapshots = {
        snapshot.meetup_id: snapshot
        for snapshot in await db.scalars(
            select(MeetupAnalytics).where(MeetupAnalytics.meetup_id.in_(ids))
        )
    }
    if all(row and row.version == ANALYTICS_VERSION for row in map(snapshots.get, ids)):
        return {mid: row.totals for mid, row in snapshots.items()}

    # Keep any cache writes outside the caller's transaction.
    async with AsyncSession(db.bind, expire_on_commit=False) as writer:
        return await _rebuild_meetup_analytics(writer, ids)


async def _rebuild_meetup_analytics(
    db: AsyncSession, ids: list[int]
) -> dict[int, dict]:
    # Acquire SQLite's writer reservation before rereading source data. The
    # invalidation triggers and cache writes cannot interleave with a rebuild.
    await db.execute(text("BEGIN IMMEDIATE"))
    snapshots = {
        snapshot.meetup_id: snapshot
        for snapshot in await db.scalars(
            select(MeetupAnalytics).where(MeetupAnalytics.meetup_id.in_(ids))
        )
    }
    current_meetups = await db.scalars(select(Meetup).where(Meetup.id.in_(ids)))
    finished = [
        meetup for meetup in current_meetups if meetup_end_time(meetup) <= utc_now()
    ]
    stale = [
        meetup
        for meetup in finished
        if meetup.id not in snapshots
        or snapshots[meetup.id].version != ANALYTICS_VERSION
    ]
    rebuilt = await _build_analytics(db, stale)
    totals = {}
    for meetup in finished:
        row = snapshots.get(meetup.id)
        if meetup.id in rebuilt:
            data = rebuilt[meetup.id]
            if row is None:
                row = MeetupAnalytics(
                    meetup_id=meetup.id, version=ANALYTICS_VERSION, totals=data
                )
                db.add(row)
            else:
                row.totals = data
                row.version = ANALYTICS_VERSION
        totals[meetup.id] = row.totals
    await db.commit()
    return totals


async def scoped_player_counts(
    db: AsyncSession, year: int | None, include_own_goals: bool
) -> dict[int, dict[str, int | float]]:
    query = select(Meetup)
    bounds = _year_bounds(year) if year is not None else None
    if bounds is not None:
        scope_ids = union(
            select(Meetup.id).where(Meetup.start_time.between(*bounds)),
            select(MeetupMatch.meetup_id).where(
                MeetupMatch.status == "completed",
                MeetupMatch.completed_at.between(*bounds),
            ),
        )
        query = query.where(Meetup.id.in_(scope_ids))
    meetups = list(await db.scalars(query))
    now = utc_now()
    snapshots = await load_meetup_analytics(
        db, [meetup for meetup in meetups if meetup_end_time(meetup) <= now]
    )
    counts: dict[int, Counter] = {}
    for snapshot in snapshots.values():
        scope = snapshot["all"] if year is None else snapshot["seasons"].get(str(year))
        if scope is not None:
            for uid, metrics in scope[int(include_own_goals)].items():
                counts.setdefault(int(uid), Counter()).update(metrics)

    open_ids = [meetup.id for meetup in meetups if meetup.id not in snapshots]
    if open_ids:
        scope = await _load_scope(db, bounds, meetup_ids=open_ids)
        kicks = await _load_kicks(db, scope[1])
        misses = await _load_misses(db, scope[1])
        for uid, metrics in _counts_for_scope(
            *scope, kicks, misses, include_own_goals
        ).items():
            counts.setdefault(int(uid), Counter()).update(metrics)
    return {uid: _with_rates(metrics) for uid, metrics in counts.items()}


async def load_cached_attributes(
    db: AsyncSession, *, year: int | None = None
) -> dict[int, dict]:
    query = select(Meetup).where(Meetup.skipped.is_(False))
    if year is not None:
        query = query.where(Meetup.start_time.between(*_year_bounds(year)))
    now = utc_now()
    finished = [
        meetup for meetup in await db.scalars(query) if meetup_end_time(meetup) <= now
    ]
    summaries = await load_meetup_analytics(db, finished)
    return combine_attribute_evidence(
        {meetup.id: meetup for meetup in finished if meetup.id in summaries},
        {mid: totals["attributes"] for mid, totals in summaries.items()},
    )


async def _rows_for_users(
    db: AsyncSession, stats: dict[int, dict[str, int | float]]
) -> list[dict]:
    if not stats:
        return []
    users = list(
        (await db.execute(select(User).where(User.id.in_(list(stats))))).scalars().all()
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
    rows.sort(
        key=lambda r: (
            direction * r[sort],
            descending_score(r["rating"]),
            r["user"]["display_name"].casefold(),
            r["user"]["id"],
        )
    )
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
            "goal_assists_per_match",
            lambda r: r["goal_assists_per_match"],
            min_matches=2,
        ),
        "wins": top("wins", lambda r: f"{r['wins']} of {r['matches']}"),
        "matches": top("matches", lambda r: r["matches"]),
        "win_rate": top(
            "win_rate", lambda r: f"{round(r['win_rate'] * 100)}%", min_matches=2
        ),
        "attendances": top("attendances", lambda r: r["attendances"]),
    }


def _team_records(
    matches: list[MeetupMatch], assists_by_side: dict[tuple[int, str], int]
) -> dict[str, dict]:
    teams: dict[str, dict] = {}
    for m in matches:
        winner = _match_winner_side(m)
        for side in ("a", "b"):
            name = m.team_a_name if side == "a" else m.team_b_name
            roster = json.loads(
                (m.team_a_users if side == "a" else m.team_b_users) or "[]"
            )
            gf = m.score_a if side == "a" else m.score_b
            ga = m.score_b if side == "a" else m.score_a
            rec = teams.setdefault(
                name,
                {
                    "wins": 0,
                    "matches": 0,
                    "goals_for": 0,
                    "goals_against": 0,
                    "assists": 0,
                    "clean_sheets": 0,
                    "_ids": set(),
                },
            )
            rec["matches"] += 1
            rec["goals_for"] += gf
            rec["goals_against"] += ga
            rec["assists"] += assists_by_side.get((m.id, side), 0)
            if winner == side:
                rec["wins"] += 1
            if not ga:
                rec["clean_sheets"] += 1
            rec["_ids"].update(roster)
    return teams


def _winning_team_names(teams: dict[str, dict]) -> list[str]:
    scores = {
        name: (team["wins"], team["goals_for"], team["assists"], team["clean_sheets"])
        for name, team in teams.items()
    }
    best = max(scores.values(), default=None)
    return sorted(name for name, score in scores.items() if score == best)


async def meetup_winning_teams(
    db: AsyncSession, matches: list[MeetupMatch]
) -> list[str]:
    if not matches:
        return []
    assists = await db.execute(
        select(MatchGoal.match_id, MatchGoal.team, func.count())
        .where(
            MatchGoal.match_id.in_([match.id for match in matches]),
            MatchGoal.deleted_at.is_(None),
            MatchGoal.is_own_goal.is_(False),
            MatchGoal.assist_id.is_not(None),
        )
        .group_by(MatchGoal.match_id, MatchGoal.team)
    )
    counts = {(match_id, side): count for match_id, side, count in assists}
    return _winning_team_names(_team_records(matches, counts))


async def _night_block(
    db: AsyncSession,
    matches: list[MeetupMatch],
    goals: list[MatchGoal],
) -> dict:
    """Per-meetup night stats: KPIs + one record per team name."""
    assists = Counter(
        (goal.match_id, goal.team)
        for goal in goals
        if goal.assist_id is not None and not goal.is_own_goal
    )
    teams = _team_records(matches, assists)
    all_player_ids = {uid for rec in teams.values() for uid in rec["_ids"]}
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
        "winning_teams": _winning_team_names(teams),
        "draw_matches": draw_matches,
    }


async def _display_names(db: AsyncSession, user_ids: set[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    users = (
        (await db.execute(select(User).where(User.id.in_(list(user_ids)))))
        .scalars()
        .all()
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
            {**row, "rank": start + i + 1}
            for i, row in enumerate(rows[start : start + per_page])
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
    stats = await scoped_player_counts(db, year, include_own_goals)
    # Players with 0 attendance in scope never appear in the tables.
    stats = {
        uid: metrics for uid, metrics in stats.items() if metrics["attendances"] > 0
    }
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
    return _envelope(
        year=None,
        available_years=None,
        rows=rows,
        night=night,
        per_page=max(1, len(rows)),
    )


async def get_user_metrics(
    db: AsyncSession,
    user_id: int,
    *,
    year: int | None = None,
    include_own_goals: bool = False,
    include_ranked_metrics: bool = False,
) -> dict[str, int | float]:
    """One user's scoped metrics (all zeros when they have no activity)."""
    metrics = (await scoped_player_counts(db, year, include_own_goals)).get(
        user_id, _zero()
    )
    return (
        metrics
        if include_ranked_metrics
        else {key: metrics[key] for key in METRIC_KEYS}
    )


async def get_user_meetup_metrics(
    db: AsyncSession,
    user_id: int,
    meetup_ids: list[int],
) -> dict[int, dict[str, int]]:
    """Per-meetup metrics for one user, in one batch (own goals included)."""
    if not meetup_ids:
        return {}
    attendances, matches, goals, subs = await _load_scope(
        db, None, meetup_ids=list(meetup_ids)
    )
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
        out[mid] = _aggregate(
            attendances, ms, gs, include_own_goals=True, subs=msubs
        ).get(user_id, _zero())
    return out
