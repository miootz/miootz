"""Import Auto team maker history into an explicit local Miootz SQLite database.

Run from the repository root:
    uv run --with openpyxl -m scripts.import_team_maker WORKBOOK --database DATABASE

The workbook supplies historical records for its own inactive template. The
ratings seed new players, and the Stats sheet is used only for reconciliation.
The command exits with status 1 if the committed import differs from Stats.
"""

import argparse
import asyncio
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from difflib import SequenceMatcher
import json
import math
from pathlib import Path
import sys
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.database import Base
from app.models.award import WeatherHeroAward
from app.models.game_template import GameTemplate
from app.models.match import MatchPenalty, MatchSubstitution, MeetupMatch
from app.models.match_goal import MatchGoal
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.services.rankings_service import _load_scope, rank_player_metrics

TEAMS = ("A", "B", "C")
ADMINS = {"Alex Example", "Casey Sample"}
SOURCE = "Auto team maker"
AWARD_SOURCE = "team-maker:roster"
SHOOTOUT = (date(2024, 4, 15), 1)
Example City = ZoneInfo("UTC")
MATCH_MINUTES = 10
WORKBOOK_METRICS = {
    "Nights": "attendances",
    "Matches": "matches",
    "Wins": "wins",
    "Losses": "losses",
    "Win %": "win_rate",
    "Goals": "goals",
    "Own goals": "own_goals",
    "Assists": "assists",
    "Goals / match": "goals_per_match",
    "Assists / match": "assists_per_match",
    "G+A / match": "goal_assists_per_match",
    "Pens taken": "penalties_taken",
    "Pens scored": "penalties_scored",
    "Pen %": "penalty_conversion_rate",
}
STAT_COLUMNS = tuple(WORKBOOK_METRICS)
ROSTER_COLUMNS = (
    "Name",
    "Rating",
    "Runs",
    "Strength",
    "Attendance",
    "Att. rank (%)",
    "Sort key",
    "Tokens",
)


@dataclass
class Match:
    teams: tuple[str, str]
    score: tuple[int, int]
    penalty_winner: str | None
    rosters: tuple[list[str], list[str]]
    previous_rosters: tuple[list[str], list[str]]
    goals: list[tuple[str, str, str | None, str]] = field(default_factory=list)
    kicks: list[tuple[str, str, bool]] = field(default_factory=list)


@dataclass
class Night:
    lineup: dict[str, list[str]] = field(default_factory=lambda: {t: [] for t in TEAMS})
    matches: dict[int, Match] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def sheet_rows(workbook, sheet, headers):
    rows = workbook[sheet].iter_rows(max_col=len(headers), values_only=True)
    if next(rows, None) != headers:
        raise ValueError(f"{sheet}: unexpected columns or missing header")
    for number, values in enumerate(rows, 2):
        if any(value is not None for value in values):
            yield f"{sheet} row {number}", values


def night_date(value):
    if not isinstance(value, datetime):
        raise ValueError(f"Expected an Excel date, got {value!r}")
    day = value.date()
    return date(2024, 3, 18) if day == date(2024, 3, 19) else day


def whole_number(value, label):
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value < 0
        or int(value) != value
    ):
        raise ValueError(f"{label}: expected a nonnegative whole number, got {value!r}")
    return int(value)


def read_workbook(path):
    from openpyxl import load_workbook

    with path.open("rb") as source:
        workbook = load_workbook(
            source, data_only=True, read_only=True, keep_links=False
        )
        try:
            return parse_workbook(workbook)
        finally:
            workbook.close()


def parse_workbook(workbook):
    ratings = {}
    tokens = {}
    names = {}
    warnings = []
    for label, (name, rating, *_, token) in sheet_rows(
        workbook, "Roster", ROSTER_COLUMNS
    ):
        if (
            not isinstance(name, str)
            or not name.strip()
            or name.strip().casefold() in names
        ):
            raise ValueError(f"{label}: missing or duplicate player name {name!r}")
        if not isinstance(rating, (int, float)) or not 1 <= rating <= 5:
            raise ValueError(f"{label}: expected a roster rating from 1 through 5")
        name = name.strip()
        names[name.casefold()] = name
        ratings[name] = 5 * (5 - rating) / 4
        tokens[name] = 0 if token is None else whole_number(token, f"{label} Tokens")
    if not ADMINS <= ratings.keys():
        raise ValueError(
            f"Missing administrators in Roster: {', '.join(sorted(ADMINS - ratings.keys()))}"
        )

    def player(raw, label):
        if not isinstance(raw, str) or not raw.strip():
            raise ValueError(f"{label}: missing player name")
        key = raw.strip().casefold()
        if key not in names:
            scores = sorted(
                (SequenceMatcher(None, key, candidate).ratio(), name)
                for candidate, name in ratings_by_key.items()
            )
            score, name = scores[-1]
            if score < 0.84 or score - scores[-2][0] < 0.08:
                raise ValueError(
                    f"{label}: cannot confidently match {raw!r}; closest is {name!r}"
                )
            names[key] = name
            warnings.append(f"{label}: matched {raw!r} to {name!r}")
        return names[key]

    ratings_by_key = names.copy()
    nights = {}
    night = None
    for label, (value, a, b, c, note) in sheet_rows(
        workbook, "Lineups", ("Date", "Team A", "Team B", "Team C", "Notes")
    ):
        if value is not None:
            day = night_date(value)
            if day in nights:
                raise ValueError(f"{label}: duplicate night {day}")
            night = nights[day] = Night()
            if day != value.date():
                warnings.append(f"{label}: corrected {value.date()} to {day}")
        if night is None:
            raise ValueError(f"{label}: lineup has no date")
        if note:
            night.notes.append(str(note))
        for team, raw in zip(TEAMS, (a, b, c), strict=True):
            if raw is not None:
                night.lineup[team].append(player(raw, label))
    if not nights:
        raise ValueError("Lineups: no meetup dates")

    match_rows = defaultdict(dict)
    for label, (value, number, _, a, b, score_a, score_b, pens, winner) in sheet_rows(
        workbook,
        "Matches",
        (
            "Date",
            "Match #",
            "Sits out",
            "Team 1",
            "Team 2",
            "Goals T1",
            "Goals T2",
            "Pens winner",
            "Winner",
        ),
    ):
        day, number = night_date(value), whole_number(number, label)
        scores = whole_number(score_a, label), whole_number(score_b, label)
        if (
            day not in nights
            or number in match_rows[day]
            or a == b
            or {a, b} - set(TEAMS)
        ):
            raise ValueError(f"{label}: invalid or duplicate match for {day}")
        first_tie = number == 1 and scores[0] == scores[1]
        expected_winner = a if scores[0] > scores[1] else b
        if first_tie:
            if pens not in (a, b):
                raise ValueError(
                    f"{label}: missing penalty winner for a tied first match"
                )
            expected_winner = pens
        if winner != expected_winner or (pens and not first_tie):
            raise ValueError(
                f"{label}: winner does not agree with the score and rotation rules"
            )
        match_rows[day][number] = (a, b, scores, pens or None)

    windows = defaultdict(dict)
    for label, (value, first, raw, target, last) in sheet_rows(
        workbook,
        "Swaps",
        ("Date", "From match #", "Player", "To team", "To match #"),
    ):
        day = night_date(value)
        if day not in match_rows:
            raise ValueError(f"{label}: no matches on {day}")
        name = player(raw, label)
        target = str(target).strip().upper()
        first = whole_number(first, label)
        last = max(match_rows[day]) if last is None else whole_number(last, label)
        if first not in match_rows[day] or last not in match_rows[day] or last < first:
            raise ValueError(f"{label}: invalid match range {first}–{last}")
        starting_teams = nights[day].lineup
        if not any(name in team for team in starting_teams.values()) or target not in (
            *TEAMS,
            "OUT",
        ):
            raise ValueError(f"{label}: player or destination is absent from the night")
        for number in range(first, last + 1):
            if name in windows[day, number]:
                raise ValueError(f"{label}: overlapping swap windows for {name}")
            windows[day, number][name] = target

    for day, night in nights.items():
        if not match_rows[day]:
            raise ValueError(f"Lineups: no matches on {day}")
        if sorted(match_rows[day]) != list(range(1, len(match_rows[day]) + 1)):
            raise ValueError(f"Matches: nonconsecutive match numbers on {day}")
        starters = {
            name: team for team, members in night.lineup.items() for name in members
        }
        if len(starters) != sum(map(len, night.lineup.values())):
            raise ValueError(f"Lineups: a player has multiple teams on {day}")
        previous = night.lineup.copy()
        for number, (a, b, score, winner) in sorted(match_rows[day].items()):
            # OUT is the non-playing roster. Match snapshots store only the two teams on the pitch.
            teams = {team: [] for team in (*TEAMS, "OUT")}
            for name, original in starters.items():
                teams[windows[day, number].get(name, original)].append(name)
            for team in TEAMS:
                # Preserve original order and append transfers, so a swap never reorders other players.
                teams[team].sort(key=lambda name: starters[name] != team)
            night.matches[number] = Match(
                (a, b), score, winner, (teams[a], teams[b]), (previous[a], previous[b])
            )
            previous[a], previous[b] = teams[a], teams[b]

    for label, (value, number, raw, kind, assist) in sheet_rows(
        workbook,
        "Goals",
        ("Date", "Match #", "Scorer", "Type", "Assist"),
    ):
        day, number = night_date(value), whole_number(number, label)
        match = nights[day].matches.get(number) if day in nights else None
        if match is None:
            raise ValueError(f"{label}: no match {number} on {day}")
        scorer = player(raw, label)
        kind = str(kind or "Goal").strip().casefold()
        if scorer in match.rosters[0]:
            side = "a"
        elif scorer in match.rosters[1]:
            side = "b"
        else:
            raise ValueError(f"{label}: scorer {scorer} is not on either playing team")
        if kind in ("shootout scored", "shootout missed"):
            if (day, number) != SHOOTOUT or match.penalty_winner is None or assist:
                raise ValueError(f"{label}: unexpected shootout kick")
            match.kicks.append((side, scorer, kind == "shootout scored"))
        elif kind == "penalty missed":
            warnings.append(
                f"{label}: {scorer}'s missed in-game penalty has no Miootz event type"
            )
        elif kind in ("goal", "own goal", "penalty"):
            side_index = "ab".index(side)
            if kind == "own goal":
                side_index = 1 - side_index
            assister = player(assist, label) if assist else None
            if assister and (
                assister == scorer or assister not in match.rosters[side_index]
            ):
                raise ValueError(f"{label}: invalid assist by {assister}")
            match.goals.append(("b" if side_index else "a", scorer, assister, kind))
        else:
            raise ValueError(f"{label}: unrecognized goal type {kind!r}")

    for day, night in nights.items():
        for number, match in night.matches.items():
            goal_counts = Counter(side for side, *_ in match.goals)
            if tuple(goal_counts[s] for s in "ab") != match.score:
                warnings.append(
                    f"{day} match {number}: goal log is {goal_counts['a']}–{goal_counts['b']}; "
                    f"keeping the Matches score {match.score[0]}–{match.score[1]}"
                )
            if match.kicks:
                counts = Counter(side for side, _, scored in match.kicks if scored)
                winner = match.teams[0 if counts["a"] > counts["b"] else 1]
                if counts["a"] == counts["b"] or winner != match.penalty_winner:
                    raise ValueError(
                        f"{day} match {number}: kicks disagree with penalty winner"
                    )

    expected = {}
    for label, (raw, *values) in sheet_rows(
        workbook, "Stats", ("Player", *STAT_COLUMNS)
    ):
        name = player(raw, label)
        if name in expected or any(
            not isinstance(value, (int, float)) for value in values
        ):
            raise ValueError(
                f"{label}: missing cached statistics or duplicate player {name}"
            )
        expected[name] = values
    if missing := ratings.keys() - expected.keys():
        warnings.append(f"Stats has no results for {', '.join(sorted(missing))}")
    return ratings, tokens, nights, expected, warnings


async def upsert_users(db, ratings, links):
    users = {}
    for name, skill in ratings.items():
        user = await db.scalar(select(User).where(User.historical_roster_name == name))
        if user is None:
            candidates = []
            if name in links:
                linked = await db.scalar(
                    select(User).where(User.pocket_id_sub == links[name])
                )
                if linked is not None:
                    candidates.append(linked)
            candidates.extend(
                (
                    await db.scalars(
                        select(User).where(
                            User.sso_preferred_username == name,
                            User.historical_roster_name.is_(None),
                        )
                    )
                ).all()
            )
            if len({u.id for u in candidates}) > 1:
                raise ValueError(f"{name}: more than one existing user could match")
            if candidates:
                user = candidates[0]
                if user.historical_roster_name is not None:
                    raise ValueError(
                        f"{name}: existing Pocket ID belongs to another roster player"
                    )
                if user.pocket_id_sub and user.pocket_id_sub != links.get(name):
                    raise ValueError(
                        f"{name}: confirm the existing account with --link-pocket-id"
                    )
            else:
                user = User(sso_display_name=name, sso_preferred_username=name)
                db.add(user)
            user.historical_roster_name = name
        if user.calculated_skill is None:
            user.calculated_skill = skill
        if name in ADMINS:
            user.is_admin = True
        if name in links:
            subject = links[name]
            if user.pocket_id_sub not in (None, subject):
                raise ValueError(
                    f"{name}: existing Pocket ID link differs from the requested one"
                )
            linked = await db.scalar(select(User).where(User.pocket_id_sub == subject))
            if linked is not None and linked is not user:
                raise ValueError(
                    f"{name}: Pocket ID is already linked to a different user"
                )
            user.pocket_id_sub = subject
        users[name] = user
    await db.flush()
    return {name: user.id for name, user in users.items()}


async def import_awards(db, tokens, ids):
    counts = dict(
        (
            await db.execute(
                select(WeatherHeroAward.user_id, func.count(WeatherHeroAward.id))
                .where(WeatherHeroAward.import_source == AWARD_SOURCE)
                .group_by(WeatherHeroAward.user_id)
            )
        ).all()
    )
    for name, count in tokens.items():
        user_id = ids[name]
        for _ in range(count - counts.get(user_id, 0)):
            db.add(WeatherHeroAward(user_id=user_id, import_source=AWARD_SOURCE))


async def upsert_match(db, meetup, number, source, ids):
    match = (
        await db.scalars(
            select(MeetupMatch).where(
                MeetupMatch.meetup_id == meetup.id,
                MeetupMatch.match_number == number,
            )
        )
    ).one_or_none()
    if match is None:
        match = MeetupMatch(meetup_id=meetup.id, match_number=number)
        db.add(match)
    started = meetup.start_time + timedelta(minutes=(number - 1) * MATCH_MINUTES)
    finished = started + timedelta(minutes=MATCH_MINUTES)
    match.team_a_name, match.team_b_name = (f"Team {team}" for team in source.teams)
    match.team_a_users, match.team_b_users = (
        json.dumps([ids[name] for name in roster]) for roster in source.rosters
    )
    match.score_a, match.score_b = source.score
    match.status = "completed"
    match.was_draw = match.score_a == match.score_b
    match.penalty_winner = (
        "ab"[source.teams.index(source.penalty_winner)]
        if source.penalty_winner
        else None
    )
    match.penalty_score_a = (
        int(match.penalty_winner == "a") if match.penalty_winner else None
    )
    match.penalty_score_b = (
        int(match.penalty_winner == "b") if match.penalty_winner else None
    )
    match.created_at = match.timer_started_at = started
    match.completed_at = finished
    match.timer_total_seconds = MATCH_MINUTES * 60
    match.timer_seconds_remaining = 0
    await db.flush()

    prefix = f"team-maker:{meetup.id}:{number}:"
    goals = await db.scalars(select(MatchGoal).where(MatchGoal.match_id == match.id))
    imported = {}
    counts = Counter(side for side, *_ in source.goals)
    for goal in goals:
        if goal.intent_id.startswith(prefix):
            imported[goal.intent_id] = goal
        elif goal.deleted_at is None:
            counts[goal.team] += 1
    match.score_offset_a, match.score_offset_b = (
        score - counts[side] for side, score in zip("ab", source.score, strict=True)
    )
    for index, (side, scorer, assister, kind) in enumerate(source.goals, 1):
        key = f"{prefix}{index}"
        goal = imported.pop(key, None)
        if goal is None:
            goal = MatchGoal(
                match_id=match.id,
                intent_id=key,
                goalkeeper_id=None,
                clock_secs=0,
                clock_minute=0,
                recorded_by=ids["Alex Example"],
                created_at=started,
            )
            db.add(goal)
        goal.team = side
        goal.scorer_id = ids[scorer]
        goal.assist_id = ids[assister] if assister else None
        goal.is_own_goal = kind == "own goal"
        goal.is_penalty = kind == "penalty"
        goal.deleted_at = None
    for goal in imported.values():
        await db.delete(goal)

    # A historical match start or finish timestamp identifies the source's snapshots and kicks.
    subs = (
        await db.scalars(
            select(MatchSubstitution).where(
                MatchSubstitution.match_id == match.id,
                MatchSubstitution.created_at == started,
                MatchSubstitution.clock_secs.is_(None),
            )
        )
    ).all()
    if source.previous_rosters != source.rosters:
        sub = (
            subs[0]
            if subs
            else MatchSubstitution(
                meetup_id=meetup.id,
                match_id=match.id,
                recorded_by=ids["Alex Example"],
                created_at=started,
            )
        )
        db.add(sub)
        sub.old_team_a_users, sub.old_team_b_users = (
            json.dumps([ids[name] for name in roster])
            for roster in source.previous_rosters
        )
        sub.new_team_a_users, sub.new_team_b_users = (
            match.team_a_users,
            match.team_b_users,
        )
        subs = subs[1:]
    for sub in subs:
        await db.delete(sub)

    kicks = (
        await db.scalars(
            select(MatchPenalty)
            .where(
                MatchPenalty.match_id == match.id,
                MatchPenalty.created_at == finished,
            )
            .order_by(MatchPenalty.id)
        )
    ).all()
    for index, (side, scorer, scored) in enumerate(source.kicks):
        kick = (
            kicks[index]
            if index < len(kicks)
            else MatchPenalty(match_id=match.id, created_at=finished)
        )
        db.add(kick)
        kick.team, kick.scorer_id, kick.scored = side, ids[scorer], scored
    for kick in kicks[len(source.kicks) :]:
        await db.delete(kick)


async def upsert_nights(db, nights, ids):
    template = (
        await db.scalars(select(GameTemplate).where(GameTemplate.name == SOURCE))
    ).one_or_none()
    if template is None:
        template = GameTemplate(
            name=SOURCE,
            timezone=Example City.key,
            weekday=0,
            hour=20,
            minute=0,
            location=SOURCE,
            is_active=False,
            match_duration_minutes=MATCH_MINUTES,
            allows_draws=True,
        )
        db.add(template)
        await db.flush()
    elif template.is_active:
        raise ValueError(
            f"The {SOURCE} template must be inactive before importing history"
        )

    meetup_ids = []
    for day, night in sorted(nights.items()):
        # The workbook has dates only. Anchor each evening at 20:00 local for the history view.
        start = (
            datetime.combine(day, time(20), Example City)
            .astimezone(UTC)
            .replace(tzinfo=None)
        )
        meetup = (
            await db.scalars(
                select(Meetup).where(
                    Meetup.game_template_id == template.id,
                    Meetup.start_time == start,
                )
            )
        ).one_or_none()
        if meetup is None:
            meetup = Meetup(
                game_template_id=template.id,
                start_time=start,
                location=SOURCE,
                match_duration_minutes=MATCH_MINUTES,
            )
            db.add(meetup)
        teams = [[ids[name] for name in night.lineup[team]] for team in TEAMS]
        attending = {uid for team in teams for uid in team}
        meetup.max_teams = len(teams)
        meetup.max_players = max(15, len(attending))
        meetup.manual_teams_json = json.dumps(teams)
        meetup.team_names_json = json.dumps([f"Team {team}" for team in TEAMS])
        meetup.duration_minutes = len(night.matches) * MATCH_MINUTES
        await db.flush()
        meetup_ids.append(meetup.id)

        by_user = {}
        for row in await db.scalars(
            select(Attendance).where(Attendance.meetup_id == meetup.id)
        ):
            if row.user_id in by_user:
                raise ValueError(
                    f"{day}: multiple attendance rows for user {row.user_id}"
                )
            by_user[row.user_id] = row
        for uid in sorted(attending):
            row = by_user.pop(uid, None)
            if row is None:
                row = Attendance(meetup_id=meetup.id, user_id=uid, joined_at=start)
                db.add(row)
            row.status = "confirmed"
        for row in by_user.values():
            if row.joined_at == start:
                await db.delete(row)
        for number, source in night.matches.items():
            await upsert_match(db, meetup, number, source, ids)
    return meetup_ids


async def compare_stats(db, meetup_ids, ids, expected):
    await db.flush()
    scope = await _load_scope(db, None, meetup_ids=meetup_ids)
    stats = await rank_player_metrics(db, *scope)

    differences = []
    for name, workbook_values in expected.items():
        metrics = stats.get(ids[name], {})
        for (metric, key), wanted in zip(
            WORKBOOK_METRICS.items(), workbook_values, strict=True
        ):
            actual = metrics.get(key, 0)
            if not math.isclose(wanted, actual, rel_tol=0, abs_tol=1e-8):
                differences.append(
                    f"{name}, {metric}: workbook {wanted:g}, imported {actual:g}"
                )
    return differences


async def import_workbook(database, ratings, tokens, nights, expected, links):
    from app.core.migrations import run_sqlite_migrations
    from sqlalchemy.engine import URL

    database.parent.mkdir(parents=True, exist_ok=True)
    engine = create_async_engine(URL.create("sqlite+aiosqlite", database=str(database)))
    try:
        async with engine.connect() as conn:
            await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
            # Serialize imports during lookup and upsert, even for rows with no unique key.
            await conn.exec_driver_sql("BEGIN IMMEDIATE")
            await conn.run_sync(Base.metadata.create_all)
            await run_sqlite_migrations(conn)
            async with AsyncSession(bind=conn) as db:
                ids = await upsert_users(db, ratings, links)
                await import_awards(db, tokens, ids)
                meetup_ids = await upsert_nights(db, nights, ids)
                differences = await compare_stats(db, meetup_ids, ids, expected)
            await conn.commit()
            return differences
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument(
        "--database", type=Path, required=True, help="Target SQLite database file"
    )
    parser.add_argument(
        "--link-pocket-id",
        action="append",
        default=[],
        metavar="PLAYER=UUID",
        help="Attach an existing Pocket ID account to a roster player",
    )
    args = parser.parse_args()
    try:
        ratings, tokens, nights, expected, warnings = read_workbook(args.workbook)
        links = {}
        for link in args.link_pocket_id:
            name, _, subject = link.partition("=")
            if name not in ratings or name in links:
                raise ValueError(
                    f"Unknown or repeated player in --link-pocket-id: {name!r}"
                )
            links[name] = str(UUID(subject))
        differences = asyncio.run(
            import_workbook(args.database, ratings, tokens, nights, expected, links)
        )
    except (KeyError, OSError, ValueError) as exc:
        parser.exit(1, f"Import failed: {exc}\n")

    matches = [match for night in nights.values() for match in night.matches.values()]
    print(
        f"Imported {len(ratings)} players, {len(nights)} meetups, {len(matches)} matches, "
        f"{sum(len(match.goals) for match in matches)} goals and "
        f"{sum(len(match.kicks) for match in matches)} shootout kicks."
    )
    for day, night in sorted(nights.items()):
        for note in night.notes:
            print(f"Workbook note, {day}: {note}")
    for warning in warnings:
        print(f"Source warning: {warning}", file=sys.stderr)
    for difference in differences:
        print(f"Stats mismatch: {difference}", file=sys.stderr)
    print(
        f"Stats: compared {len(expected)} players across {len(STAT_COLUMNS)} metrics, "
        f"{len(differences)} differences."
    )
    return bool(differences)


if __name__ == "__main__":
    sys.exit(main())
