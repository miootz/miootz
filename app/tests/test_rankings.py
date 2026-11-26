"""Season & meetup rankings.

Covers: year boundary (2025 vs 2026), own-goal exclusion/toggle, explicit
crediting only (assist/keeper credit only when mentioned), team-wide clean
sheets, zero-attendance exclusion, pagination, sorting, and the
meetup-scoped endpoint (incl. 404 without completed matches).
"""

import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.core.timeutil import utcnow
from app.models.match import MatchPenalty, MeetupMatch, PenaltyMiss
from app.models.match_goal import MatchGoal
from app.models.meetup import Attendance, Meetup
from app.models.meetup_analytics import MeetupAnalytics, MeetupRatingSnapshot
from app.models.rating import Rating
from app.models.user import User
from app.services.rating_settings import RatingSettings
from app.services import rankings_service
from app.services.player_progress import record_due_rating_snapshots

TOKENS = ["p1", "p2", "p3", "tp1"]


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def client() -> AsyncClient:
    from httpx import ASGITransport

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def ids_for(tokens: list[str]) -> dict[str, int]:
    async with AsyncSession(engine) as db:
        rows = (
            await db.execute(
                select(User).where(User.pocket_id_sub.in_([f"{t}-uuid" for t in tokens]))
            )
        ).scalars().all()
    return {u.pocket_id_sub.replace("-uuid", ""): u.id for u in rows}


async def seed(ac: AsyncClient) -> dict[str, int]:
    # JIT-provision the four users, then insert two seasons of data directly.
    for t in TOKENS:
        r = await ac.get("/meetups/", headers=hdr(t))
        assert r.status_code == 200, r.text
    ids = await ids_for(TOKENS)

    m2025 = Meetup(
        id=1, start_time=datetime(2025, 12, 30, 19), location="Pitch",
        min_players=1, max_players=10,
    )
    m2026 = Meetup(
        id=2, start_time=datetime(2026, 1, 2, 19), location="Pitch",
        min_players=1, max_players=10,
    )
    m_nomatch = Meetup(
        id=3, start_time=datetime(2026, 1, 3, 19), location="Pitch",
        min_players=1, max_players=10,
    )
    async with AsyncSession(engine) as db:
        db.add_all([m2025, m2026, m_nomatch])
        db.add_all([
            Attendance(meetup_id=1, user_id=ids[t], status="confirmed")
            for t in ("p1", "p2", "p3")
        ])
        db.add_all([
            Attendance(meetup_id=2, user_id=ids[t], status="confirmed")
            for t in ("p1", "p2")
        ])
        db.add(Attendance(meetup_id=3, user_id=ids["p1"], status="confirmed"))
        m1 = MeetupMatch(
            meetup_id=1, match_number=1,
            team_a_users=json.dumps([ids["p1"], ids["p2"]]),
            team_b_users=json.dumps([ids["p3"]]),
            team_a_name="A", team_b_name="B",
            score_a=1, score_b=0, status="completed",
            timer_total_seconds=600, timer_seconds_remaining=0,
            created_at=datetime(2025, 12, 30, 19, 10), completed_at=datetime(2025, 12, 30, 20),
        )
        m2 = MeetupMatch(
            meetup_id=2, match_number=1,
            team_a_users=json.dumps([ids["p1"]]),
            team_b_users=json.dumps([ids["p2"]]),
            team_a_name="A", team_b_name="B",
            score_a=0, score_b=1, status="completed",
            timer_total_seconds=600, timer_seconds_remaining=0,
            created_at=datetime(2026, 1, 2, 19, 10), completed_at=datetime(2026, 1, 2, 20),
        )
        m3 = MeetupMatch(
            meetup_id=2, match_number=2,
            team_a_users=json.dumps([ids["p1"]]),
            team_b_users=json.dumps([ids["p2"]]),
            team_a_name="A", team_b_name="B",
            score_a=2, score_b=0, status="completed",
            timer_total_seconds=600, timer_seconds_remaining=0,
            created_at=datetime(2026, 1, 2, 20, 5), completed_at=datetime(2026, 1, 2, 20, 15),
        )
        db.add_all([m1, m2, m3])
        await db.flush()
        db.add_all([
            # 2025: p1 scores, p2 assists, p3 (keeper) is beaten; tp1 assists
            # with zero attendance (must be excluded from the tables).
            MatchGoal(
                match_id=m1.id, team="a", scorer_id=ids["p1"], assist_id=ids["tp1"],
                goalkeeper_id=ids["p3"], clock_secs=540, clock_minute=6,
                recorded_by=ids["p1"], intent_id="rk-1",
                created_at=datetime(2025, 12, 30, 19, 16),
            ),
            # 2026: p2 scores (no assist, no keeper mentioned — nobody else credited).
            MatchGoal(
                match_id=m2.id, team="b", scorer_id=ids["p2"],
                clock_secs=540, clock_minute=7,
                recorded_by=ids["p2"], intent_id="rk-2",
                created_at=datetime(2026, 1, 2, 19, 17),
            ),
            MatchGoal(
                match_id=m3.id, team="a", scorer_id=ids["p1"], assist_id=None,
                goalkeeper_id=ids["p2"], clock_secs=480, clock_minute=8,
                recorded_by=ids["p1"], intent_id="rk-3",
                created_at=datetime(2026, 1, 2, 20, 8),
            ),
            # 2026: own goal by p2 (on the conceding team) into B's net for A.
            MatchGoal(
                match_id=m3.id, team="a", scorer_id=ids["p2"], assist_id=None,
                goalkeeper_id=None, clock_secs=420, clock_minute=9,
                after_whistle=False, is_own_goal=True,
                recorded_by=ids["p1"], intent_id="rk-4",
                created_at=datetime(2026, 1, 2, 20, 9),
            ),
        ])
        await db.commit()
    return ids


def rows_by_name(j: dict) -> dict[str, dict]:
    return {r["user"]["display_name"]: r for r in j["rows"]}


async def test_metric_ties_follow_active_rating():
    async with await client() as ac:
        ids = await seed(ac)
        async with AsyncSession(engine) as db:
            p1 = await db.get(User, ids["p1"])
            p2 = await db.get(User, ids["p2"])
            p1.calculated_skill, p2.calculated_skill = 3, 4
            p1.seed_skill, p2.seed_skill = 4, 3
            await db.commit()

        url = "/rankings?year=2026&sort=goals&order=asc"
        result = (await ac.get(url, headers=hdr("p1"))).json()
        assert [row["user"]["id"] for row in result["rows"]] == [ids["p2"], ids["p1"]]
        assert result["highlights"]["goals"][0]["user_id"] == ids["p2"]

        async with AsyncSession(engine) as db:
            db.add(RatingSettings(id=1, computed_scores=False))
            await db.commit()
        result = (await ac.get(url, headers=hdr("p1"))).json()
        assert [row["user"]["id"] for row in result["rows"]] == [ids["p1"], ids["p2"]]


async def test_rating_ties_use_shooting_then_passing_then_defending():
    async with await client() as ac:
        ids = await seed(ac)
        async with AsyncSession(engine) as db:
            overrides = {
                "p1": (4, 4, 4),
                "p2": (4, 4, 3),
                "p3": (5, 1, 1),
                "tp1": (4, 3, 5),
            }
            for token, scores in overrides.items():
                user = await db.get(User, ids[token])
                user.calculated_skill = 3
                user.sho_override, user.pas_override, user.def_override = scores
            await db.commit()

        result = (await ac.get("/rankings/attributes?year=all&sort=rating&order=asc", headers=hdr("p1"))).json()
        assert [row["user"]["id"] for row in result["rows"]] == [
            ids[token] for token in ("p3", "p1", "p2", "tp1")
        ]


@pytest.mark.asyncio
async def test_season_boundary_and_crediting():
    async with await client() as ac:
        await seed(ac)

        j = (await ac.get("/rankings?year=2025", headers=hdr("p1"))).json()
        assert j["year"] == 2025
        assert j["available_years"] == [2025, 2026]
        rows = rows_by_name(j)
        assert set(rows) == {"P1", "P2", "P3"}  # TP1: assist but zero attendance
        assert rows["P1"]["goals"] == 1 and rows["P3"]["goals_conceded"] == 1
        assert rows["P2"]["assists"] == 0  # P2's only assist was in 2026
        # Clean sheet: whole roster of the team that conceded 0 (P1, P2).
        assert rows["P1"]["clean_sheets"] == 1 and rows["P2"]["clean_sheets"] == 1
        assert rows["P3"]["clean_sheets"] == 0

        j = (await ac.get("/rankings?year=2026", headers=hdr("p1"))).json()
        rows = rows_by_name(j)
        assert set(rows) == {"P1", "P2"}
        # Own goal excluded by default: P1 has only the regular goal.
        assert rows["P1"]["goals"] == 1 and rows["P2"]["goals"] == 1
        assert rows["P2"]["goals_conceded"] == 1
        # No assist/keeper mentioned on the P2 goal — nothing extra credited.
        assert rows["P1"]["assists"] == 0

        # With the toggle, the own goal is credited to its listed scorer (P2).
        j = (await ac.get("/rankings?year=2026&include_own_goals=1", headers=hdr("p1"))).json()
        assert rows_by_name(j)["P2"]["goals"] == 2

        j = (await ac.get("/rankings?year=all", headers=hdr("p1"))).json()
        rows = rows_by_name(j)
        assert rows["P1"]["attendances"] == 3 and rows["P1"]["goals"] == 2
        assert rows["P3"]["attendances"] == 1


@pytest.mark.asyncio
async def test_default_scope_is_current_year_and_sorting():
    async with await client() as ac:
        await seed(ac)
        j = (await ac.get("/rankings", headers=hdr("p1"))).json()
        assert j["year"] == datetime.now().year  # current season by default
        j = (await ac.get("/rankings?year=all&sort=goals&order=desc", headers=hdr("p1"))).json()
        names = [r["user"]["display_name"] for r in j["rows"]]
        assert names[0] == "P1"  # 2 goals, P2 has 1 (own goal excluded by default)
        j = (await ac.get("/rankings?year=all&sort=goals_conceded&order=asc", headers=hdr("p1"))).json()
        names = [r["user"]["display_name"] for r in j["rows"]]
        # P1 conceded 0; P2/P3 tie at 1 and order by name.
        assert names == ["P1", "P2", "P3"]


async def test_losses_per_match_rates_and_penalties_are_scoped_and_sortable(monkeypatch):
    monkeypatch.setattr("app.services.stats_service.utcnow", lambda: datetime(2026, 6, 1))
    async with await client() as ac:
        ids = await seed(ac)
        async with AsyncSession(engine) as db:
            first_2026 = await db.scalar(
                select(MeetupMatch).where(
                    MeetupMatch.meetup_id == 2, MeetupMatch.match_number == 1
                )
            )
            first_2026.score_a = first_2026.score_b
            first_2026.penalty_winner = "a"
            first_2026.was_draw = True
            penalty_goal = await db.scalar(
                select(MatchGoal).where(MatchGoal.intent_id == "rk-2")
            )
            penalty_goal.is_penalty = True
            penalty_goal.assist_id = ids["p3"]
            old_match = await db.scalar(select(MeetupMatch).where(MeetupMatch.meetup_id == 1))
            db.add_all([
                Attendance(meetup_id=2, user_id=ids["p3"], status="confirmed"),
                Attendance(meetup_id=3, user_id=ids["tp1"], status="confirmed"),
                MatchPenalty(match_id=first_2026.id, team="b", scorer_id=ids["p2"], scored=False),
                MatchPenalty(match_id=first_2026.id, team="b", scorer_id=ids["p2"], scored=True),
                MatchPenalty(match_id=old_match.id, team="a", scorer_id=ids["p1"], scored=True),
            ])
            first_2026.team_b_users = json.dumps([ids["p2"], ids["p3"]])
            await db.commit()

        response = await ac.get("/rankings?year=2026&sort=penalties_taken", headers=hdr("p1"))
        assert response.status_code == 200, response.text
        rows = rows_by_name(response.json())
        assert next(iter(rows)) == "P2"
        assert rows["P1"]["wins"] == 2 and rows["P1"]["losses"] == 0
        assert rows["P1"]["penalties_taken"] == 0
        assert rows["P2"]["losses"] == 2
        assert rows["P2"]["own_goals"] == 1 and rows["P2"]["goals_per_match"] == 0
        assert rows["P2"]["penalties_taken"] == 3 and rows["P2"]["penalties_scored"] == 2
        assert rows["P2"]["penalty_conversion_rate"] == pytest.approx(2 / 3)
        assert rows["P3"]["assists_per_match"] == rows["P3"]["goal_assists_per_match"] == 0
        assert rows["TP1"]["goals_per_match"] == rows["TP1"]["penalty_conversion_rate"] == 0

        response = await ac.get("/users/me/stats", headers=hdr("p2"))
        assert response.status_code == 200, response.text
        profile = response.json()
        assert profile["season_losses"] == 2
        assert profile["season_goal_assists_per_match"] == 0
        assert profile["season_penalties_taken"] == 3
        assert profile["season_penalties_scored"] == 2
        assert profile["season_penalty_conversion_rate"] == pytest.approx(2 / 3)
        assert profile["goals"] == 0 and profile["matches"] == 3

        response = await ac.get("/users/me/stats", headers=hdr("p3"))
        assert response.status_code == 200, response.text
        assert response.json()["season_assists"] == 0
        assert response.json()["season_goal_assists_per_match"] == 0

        response = await ac.get("/users/me/stats", headers=hdr("p1"))
        assert response.status_code == 200, response.text
        assert response.json()["season_penalties_taken"] == 0  # 2025 kick is out of scope.

        response = await ac.get("/users/me/stats", headers=hdr("tp2"))
        assert response.status_code == 200, response.text
        profile = response.json()
        assert all(profile[key] == 0 for key in (
            "season_losses", "season_goal_assists_per_match", "season_penalties_taken",
            "season_penalties_scored", "season_penalty_conversion_rate",
        ))

        response = await ac.get("/rankings?year=all&sort=penalties_scored", headers=hdr("p1"))
        assert rows_by_name(response.json())["P1"]["penalties_scored"] == 1
        response = await ac.get("/meetups/2/rankings", headers=hdr("p1"))
        assert rows_by_name(response.json())["P2"]["penalty_conversion_rate"] == pytest.approx(2 / 3)


@pytest.mark.asyncio
async def test_pagination():
    async with await client() as ac:
        await seed(ac)
        j = (await ac.get("/rankings?year=all&per_page=2", headers=hdr("p1"))).json()
        assert j["total"] == 3
        assert len(j["rows"]) == 2
        assert j["rows"][0]["rank"] == 1
        j2 = (await ac.get("/rankings?year=all&per_page=2&page=2", headers=hdr("p1"))).json()
        assert len(j2["rows"]) == 1
        assert j2["rows"][0]["rank"] == 3
        # Default sort: P1 (2 attendances, 2 clean sheets) then P2, then P3.
        assert [r["user"]["display_name"] for r in j["rows"]] == ["P1", "P2"]
        assert j2["rows"][0]["user"]["display_name"] == "P3"


@pytest.mark.asyncio
async def test_meetup_rankings_and_404():
    async with await client() as ac:
        await seed(ac)
        j = (await ac.get("/meetups/2/rankings", headers=hdr("p1"))).json()
        rows = rows_by_name(j)
        assert set(rows) == {"P1", "P2"}
        # Per-meetup view includes own goals: credited to their listed scorer.
        assert rows["P1"]["goals"] == 1 and rows["P2"]["goals"] == 2
        assert rows["P1"]["clean_sheets"] == 1  # M3: A conceded 0
        assert rows["P2"]["clean_sheets"] == 1  # M2: B conceded 0
        assert rows["P2"]["goals_conceded"] == 1
        assert j["year"] is None and j["available_years"] is None

        r = await ac.get("/meetups/3/rankings", headers=hdr("p1"))
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_history_summary_winner_tiebreakers_and_viewers_votes():
    async with await client() as ac:
        ids = await seed(ac)
        headers = hdr("p1")

        async def summary(meetup_id=2):
            response = await ac.get(f"/meetups/{meetup_id}/history-summary", headers=headers)
            assert response.status_code == 200
            return response.json()

        assert await summary(3) == {
            "match_count": 0, "winning_teams": [], "my_rating_avg": None,
        }
        assert (await summary())["winning_teams"] == ["A"]  # Goals break a win tie.

        async with AsyncSession(engine, expire_on_commit=False) as db:
            first, second = (await db.scalars(
                select(MeetupMatch).where(MeetupMatch.meetup_id == 2)
                .order_by(MeetupMatch.match_number)
            )).all()
            first.score_b = 2
            db.add_all([
                Rating(meetup_id=2, rater_id=ids["p1"], ratee_id=ids["p2"], score=4),
                Rating(meetup_id=2, rater_id=ids["p1"], ratee_id=ids["p3"], score=4.5),
                Rating(meetup_id=2, rater_id=ids["p2"], ratee_id=ids["p1"], score=1),
            ])
            await db.commit()
            assert await summary() == {
                "match_count": 2, "winning_teams": ["A", "B"], "my_rating_avg": 4.25,
            }
            detail = (await ac.get("/meetups/2/rankings", headers=headers)).json()["night"]
            assert detail["winning_teams"] == ["A", "B"]

            goal = await db.scalar(select(MatchGoal).where(MatchGoal.match_id == first.id))
            goal.assist_id = ids["p3"]
            await db.commit()
            assert (await summary())["winning_teams"] == ["B"]  # Assists break a goals tie.
            detail = (await ac.get("/meetups/2/rankings", headers=headers)).json()["night"]
            assert detail["winning_teams"] == ["B"]
            winner = next(team for team in detail["teams"] if team["name"] == "B")
            assert [winner[key] for key in ("wins", "goals_for", "assists", "clean_sheets")] == [1, 2, 1, 1]

            goal.deleted_at = datetime(2026, 1, 2, 20)
            await db.commit()
            assert (await summary())["winning_teams"] == ["A", "B"]  # Deleted assist is ignored.

            second.score_a, second.score_b = 3, 1
            await db.commit()
            assert (await summary())["winning_teams"] == ["B"]  # Clean sheets break the tie.

            first.team_a_name, first.team_b_name = "B", "A"
            first.score_a, first.score_b, first.penalty_winner = 0, 0, "a"
            second.score_a, second.score_b = 7, 0
            db.add(MeetupMatch(
                meetup_id=2, match_number=3, team_a_name="A", team_b_name="B",
                team_a_users="[]", team_b_users="[]", score_a=0, score_b=1, status="completed",
            ))
            db.add(MeetupMatch(
                meetup_id=2, match_number=4, team_a_name="A", team_b_name="B",
                team_a_users="[]", team_b_users="[]", score_a=9, score_b=0, status="active",
            ))
            await db.commit()
            assert await summary() == {
                "match_count": 3, "winning_teams": ["B"], "my_rating_avg": 4.25,
            }


@pytest.mark.asyncio
async def test_rankings_require_auth():
    async with await client() as ac:
        r = await ac.get("/rankings")
        assert r.status_code == 401


async def seed_draw_meetups(ac: AsyncClient) -> dict[str, int]:
    """Two 1-1 meetups: one recorded as a draw, one not (default template)."""
    ids = await ids_for(TOKENS)
    m_draw = Meetup(
        id=4, start_time=datetime(2026, 1, 4, 19), location="Pitch",
        min_players=1, max_players=10,
    )
    m_nodraw = Meetup(
        id=5, start_time=datetime(2026, 1, 5, 19), location="Pitch",
        min_players=1, max_players=10,
    )
    async with AsyncSession(engine) as db:
        db.add_all([m_draw, m_nodraw])
        db.add_all([
            Attendance(meetup_id=4, user_id=ids[t], status="confirmed")
            for t in ("p1", "p2")
        ])
        db.add_all([
            Attendance(meetup_id=5, user_id=ids[t], status="confirmed")
            for t in ("p1", "p2")
        ])
        m4 = MeetupMatch(
            meetup_id=4, match_number=1,
            team_a_users=json.dumps([ids["p1"]]),
            team_b_users=json.dumps([ids["p2"]]),
            team_a_name="A", team_b_name="B",
            score_a=1, score_b=1, status="completed", was_draw=True,
            timer_total_seconds=600, timer_seconds_remaining=0,
            created_at=datetime(2026, 1, 4, 19, 10), completed_at=datetime(2026, 1, 4, 20),
        )
        m5 = MeetupMatch(
            meetup_id=5, match_number=1,
            team_a_users=json.dumps([ids["p2"]]),
            team_b_users=json.dumps([ids["p1"]]),
            team_a_name="C", team_b_name="D",
            score_a=1, score_b=1, status="completed", was_draw=False,
            timer_total_seconds=600, timer_seconds_remaining=0,
            created_at=datetime(2026, 1, 5, 19, 10), completed_at=datetime(2026, 1, 5, 20),
        )
        db.add_all([m4, m5])
        await db.commit()
    return ids


@pytest.mark.asyncio
async def test_wins_and_night_block():
    """Wins follow the de-facto winner (tie → away); night block aggregates."""
    async with await client() as ac:
        await seed(ac)
        await seed_draw_meetups(ac)

        # 2025: m1 A=[p1,p2] vs B=[p3], 1-0 → A roster wins.
        j = (await ac.get("/rankings?year=2025", headers=hdr("p1"))).json()
        rows = rows_by_name(j)
        assert rows["P1"]["wins"] == 1 and rows["P2"]["wins"] == 1
        assert rows["P3"]["wins"] == 0
        assert all(rows[n]["matches"] == 1 for n in rows)
        assert rows["P1"]["win_rate"] == 1.0 and rows["P3"]["win_rate"] == 0.0

        # Night block for meetup 1 (2025, single match).
        j = (await ac.get("/meetups/1/rankings", headers=hdr("p1"))).json()
        kpis = j["night"]["kpis"]
        assert kpis == {"matches": 1, "goals": 1, "players": 3, "draws": 0}
        assert j["night"]["draw_matches"] == []
        teams = {t["name"]: t for t in j["night"]["teams"]}
        assert teams["A"]["wins"] == 1
        assert (teams["A"]["goals_for"], teams["A"]["goals_against"], teams["A"]["goal_diff"]) == (1, 0, 1)
        assert teams["A"]["clean_sheets"] == 1
        assert {u["id"] for u in teams["A"]["roster"]} == {rows["P1"]["user"]["id"], rows["P2"]["user"]["id"]}
        assert teams["B"]["wins"] == 0 and teams["B"]["goal_diff"] == -1

        # Draws: the away roster takes the de-facto win either way; was_draw
        # only shows up in the draw count.
        j = (await ac.get("/meetups/4/rankings", headers=hdr("p1"))).json()
        assert j["night"]["kpis"]["draws"] == 1
        # The recorded draw lists the match with the away side advancing.
        assert j["night"]["draw_matches"] == [
            {"team_a": "A", "score_a": 1, "team_b": "B", "score_b": 1, "advancer": "B"}
        ]
        t = {x["name"]: x for x in j["night"]["teams"]}
        assert t["B"]["wins"] == 1 and t["A"]["wins"] == 0

        j = (await ac.get("/meetups/5/rankings", headers=hdr("p1"))).json()
        assert j["night"]["kpis"]["draws"] == 0
        assert j["night"]["draw_matches"] == []
        t = {x["name"]: x for x in j["night"]["teams"]}
        # Away team D (p1) still wins the tie without a draw record.
        assert t["D"]["wins"] == 1 and t["C"]["wins"] == 0

        # All-time win_rate sorting.
        j = (await ac.get("/rankings?year=all&sort=win_rate&order=desc", headers=hdr("p1"))).json()
        names = [r["user"]["display_name"] for r in j["rows"]]
        # P1: 3 wins / 4 matches, P2: 2 / 3, P3: 0 / 1.
        assert names == ["P1", "P2", "P3"]


@pytest.mark.asyncio
async def test_highlights():
    """Top-3 lists over the full scope. Rates need at least two matches."""
    async with await client() as ac:
        await seed(ac)
        await seed_draw_meetups(ac)

        j = (await ac.get("/rankings?year=all", headers=hdr("p1"))).json()
        h = j["highlights"]
        rows = rows_by_name(j)
        # Entries carry the user id so the client can mark the signed-in player.
        assert h["goals"][0] == {  # own goal excluded by default
            "user_id": rows["P1"]["user"]["id"], "name": "P1", "value": 2
        }
        assert h["wins"][0]["name"] == "P1"
        assert h["wins"][0]["value"] == "3 of 5"
        assert h["matches"][0] == {
            "user_id": rows["P1"]["user"]["id"], "name": "P1", "value": 5
        }
        assert h["win_rate"][0] == {
            "user_id": rows["P1"]["user"]["id"], "name": "P1", "value": "60%"
        }
        # P3 has 1 match — excluded from the win-rate highlight.
        assert all(e["name"] != "P3" for e in h["win_rate"])
        assert h["goal_assists_per_match"] == [
            {"user_id": rows[name]["user"]["id"], "name": name, "value": rate}
            for name, rate in (("P1", 2 / 5), ("P2", 1 / 5))
        ]
        assert h["attendances"][0] == {
            "user_id": rows["P1"]["user"]["id"], "name": "P1", "value": 5
        }

        # Empty scope (year with no data) → safe empty lists.
        j = (await ac.get("/rankings?year=2020", headers=hdr("p1"))).json()
        assert j["rows"] == []
        assert all(v == [] for v in j["highlights"].values())


async def test_analytics_cache_matches_raw_results_and_refreshes_only_edited_meetup():
    async with await client() as ac:
        await seed(ac)
    async with AsyncSession(engine) as db:
        # A completed match can count in a different season from attendance.
        match = await db.scalar(select(MeetupMatch).where(MeetupMatch.meetup_id == 1))
        match_id = match.id
        match.completed_at = datetime(2026, 1, 1, 0, 5)
        await db.commit()

        for year in (None, 2025, 2026):
            for own_goals in (False, True):
                bounds = rankings_service._year_bounds(year) if year else None
                source = await rankings_service._load_scope(db, bounds)
                raw = await rankings_service.rank_player_metrics(db, *source, include_own_goals=own_goals)
                cached = await rankings_service.scoped_player_counts(db, year, own_goals)
                assert {uid: row for uid, row in cached.items() if row["attendances"]} == {
                    uid: row for uid, row in raw.items() if row["attendances"]
                }

        before = await db.get(MeetupAnalytics, 2)
        assert before is not None
        goal = await db.scalar(select(MatchGoal).where(MatchGoal.match_id == match_id))
        goal.deleted_at = utcnow()
        await db.commit()

    async with AsyncSession(engine) as db:
        assert await db.get(MeetupAnalytics, 1) is None
        assert await db.get(MeetupAnalytics, 2) is not None
        source = await rankings_service._load_scope(db, None)
        raw = await rankings_service.rank_player_metrics(db, *source)
        cached = await rankings_service.scoped_player_counts(db, None, False)
        assert cached == raw
        assert await db.get(MeetupAnalytics, 1) is not None


async def test_profile_progress_returns_played_meetups_and_prospective_ratings():
    async with await client() as ac:
        ids = await seed(ac)
        response = await ac.get("/users/me/progress", headers=hdr("p1"))
        assert response.status_code == 200
        points = response.json()["meetups"]
        assert [row["meetup_id"] for row in points] == [1, 2]
        assert points[0]["base_rating"] is None

        async with AsyncSession(engine) as db:
            latest = await db.get(Meetup, 3)
            now = utcnow()
            latest.start_time = now - timedelta(hours=4)
            db.add(Meetup(
                id=4, start_time=now + timedelta(hours=4), location="Pitch",
                min_players=1, max_players=10,
            ))
            player = await db.get(User, ids["p1"])
            player.seed_skill = 3.5
            player.calculated_skill = 4
            await db.commit()

        await record_due_rating_snapshots()
        points = (await ac.get("/users/me/progress", headers=hdr("p1"))).json()["meetups"]
        assert points[0]["adjusted_rating"] is None
        assert points[-1]["base_rating"] == 3.5
        assert points[-1]["adjusted_rating"] == 4
        async with AsyncSession(engine) as db:
            pending = await db.get(MeetupRatingSnapshot, 3)
            assert pending is not None and pending.ratings is None
            (await db.get(Meetup, 4)).start_time = now - timedelta(minutes=1)
            await db.commit()

        await record_due_rating_snapshots()
        async with AsyncSession(engine) as db:
            snapshot = await db.get(MeetupRatingSnapshot, 3)
            assert snapshot.ratings[str(ids["p1"])] == {"base": 3.5, "adjusted": 4}
            assert await db.get(MeetupRatingSnapshot, 2) is None


async def test_penalty_misses_invalidate_cached_rankings_and_legacy_versions():
    async with await client() as ac:
        ids = await seed(ac)

    async with AsyncSession(engine) as db:
        await rankings_service.scoped_player_counts(db, None, False)
        old = await db.get(MeetupAnalytics, 1)
        old.version = 2
        old.totals = {}
        await db.commit()

    async with AsyncSession(engine) as db:
        counts = await rankings_service.scoped_player_counts(db, None, False)
        assert counts[ids["p1"]]["goals"] == 2
        assert (await db.get(MeetupAnalytics, 1)).version == rankings_service.ANALYTICS_VERSION == 3
        match1 = await db.scalar(select(MeetupMatch).where(MeetupMatch.meetup_id == 1))
        match2 = await db.scalar(select(MeetupMatch).where(MeetupMatch.meetup_id == 2))
        first_id, second_id = match1.id, match2.id
        db.add(PenaltyMiss(match_id=first_id, team="a", scorer_id=ids["p1"], clock_minute=2, intent_id="cache-miss"))
        await db.commit()

    async with AsyncSession(engine) as db:
        assert await db.get(MeetupAnalytics, 1) is None
        assert await db.get(MeetupAnalytics, 2) is not None
        counts = await rankings_service.scoped_player_counts(db, None, False)
        assert counts[ids["p1"]]["penalties_taken"] == 1
        assert counts[ids["p1"]]["penalties_scored"] == 0
        miss = await db.scalar(select(PenaltyMiss).where(PenaltyMiss.intent_id == "cache-miss"))
        miss.match_id = second_id
        await db.commit()

    async with AsyncSession(engine) as db:
        assert await db.get(MeetupAnalytics, 1) is None
        assert await db.get(MeetupAnalytics, 2) is None
        counts = await rankings_service.scoped_player_counts(db, None, False)
        assert counts[ids["p1"]]["penalties_taken"] == 1
        miss = await db.scalar(select(PenaltyMiss).where(PenaltyMiss.intent_id == "cache-miss"))
        await db.delete(miss)
        await db.commit()

    async with AsyncSession(engine) as db:
        assert await db.get(MeetupAnalytics, 1) is not None
        assert await db.get(MeetupAnalytics, 2) is None
        counts = await rankings_service.scoped_player_counts(db, None, False)
        assert counts[ids["p1"]]["penalties_taken"] == 0


async def test_unknown_penalty_scorer_does_not_create_a_player_count():
    async with await client() as ac:
        ids = await seed(ac)

    async with AsyncSession(engine) as db:
        match = await db.scalar(select(MeetupMatch).where(MeetupMatch.meetup_id == 1))
        db.add(MatchGoal(
            match_id=match.id, team="a", scorer_id=None, goalkeeper_id=ids["p3"],
            is_penalty=True, clock_secs=0, clock_minute=0, recorded_by=ids["p1"],
            intent_id="unknown-penalty",
        ))
        await db.commit()
        counts = await rankings_service.scoped_player_counts(db, None, True)
        assert None not in counts
        assert counts[ids["p3"]]["goals_conceded"] == 2
        assert counts[ids["p1"]]["penalties_taken"] == 0
