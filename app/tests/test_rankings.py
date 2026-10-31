"""Season & meetup rankings.

Covers: year boundary (2025 vs 2026), own-goal exclusion/toggle, explicit
crediting only (assist/keeper credit only when mentioned), team-wide clean
sheets, zero-attendance exclusion, pagination, sorting, and the
meetup-scoped endpoint (incl. 404 without completed matches).
"""

import json
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.match import MeetupMatch
from app.models.match_goal import MatchGoal
from app.models.meetup import Attendance, Meetup
from app.models.user import User

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
async def test_rankings_require_auth():
    async with await client() as ac:
        r = await ac.get("/rankings")
        assert r.status_code == 401
