"""Goalkeeper (conceding keeper) on goal entries.

Covers the optional ``goalkeeper_id`` surface:
- valid conceding-team keeper stored and shown in the goal log
- keeper from the scoring team refused (must be an opposing player)
- keeper equal to scorer / assist refused
- keeper omitted stays null (unknown/rotated keeper must never block entry)
- replay of the same intent keeps the same keeper
"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.core.migrations import run_sqlite_migrations
from app.models.match_goal import MatchGoal
from app.models.user import User


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


async def make_live_setup(ac: AsyncClient, tokens, *, start_offset_minutes: int = 0):
    """Meetup + joins + two manual teams + match started. Same as live-scoring."""
    from datetime import datetime, timedelta, UTC

    from app.models.match import MeetupMatch
    from app.models.user import User
    from sqlalchemy import select

    # Future start: joins are pre-meetup; the start is shifted into the
    # presence window after joins, before match ops.
    start = (
        datetime.now(UTC).replace(tzinfo=None)
        + timedelta(hours=1)
        + timedelta(minutes=start_offset_minutes)
    )
    r = await ac.post(
        "/meetups/",
        json={
            "start_time": start.isoformat(),
            "location": "Live Pitch",
            "min_players": 1,
            "max_players": 10,
            "send_push_notifications": False,
        },
        headers=hdr("admin"),
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]

    for t in tokens:
        rj = await ac.post(f"/meetups/{sid}/join", headers=hdr(t))
        assert rj.status_code == 200, rj.text
        assert rj.json()["status"] == "confirmed"

    async with AsyncSession(engine) as db:
        ids = {}
        for t in tokens:
            res = await db.execute(
                select(User).where(User.pocket_id_sub == f"{t}-uuid")
            )
            ids[t] = res.scalar_one().id
        from sqlalchemy import update

        from app.models.meetup import Meetup

        await db.execute(
            update(Meetup)
            .where(Meetup.id == sid)
            .values(start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=15))
        )
        await db.commit()
    half = max(len(tokens) // 2, 1)
    teams = [
        [str(ids[t]) for t in tokens[:half]],
        [str(ids[t]) for t in tokens[half:]],
    ]
    rt = await ac.patch(
        f"/meetups/{sid}/teams",
        json={"teams": teams},
        headers=hdr("admin"),
    )
    assert rt.status_code == 200, rt.text

    rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admin"))
    assert rs.status_code == 201, rs.text
    mid = rs.json()["match"]["id"]

    async with AsyncSession(engine) as db:
        res = await db.execute(select(MeetupMatch).where(MeetupMatch.id == mid))
        m = res.scalar_one()
        m.timer_started_at = datetime.now(UTC)
        m.timer_seconds_remaining = m.timer_total_seconds
        m.status = "active"
        await db.commit()
    return sid, mid, ids


# Team A: p1, p2 · Team B: p3, tp1 — A scores, B's keeper (p3) is beaten.
TOKENS = ["p1", "p2", "p3", "tp1"]


@pytest.mark.asyncio
async def test_goal_with_valid_conceding_keeper():
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, TOKENS)
        assert (
            await ac.post(f"/meetups/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p2"],
                "assist_id": ids["p1"],
                "goalkeeper_id": ids["p3"],
                "intent_id": "gk-1",
            },
            headers=hdr("p1"),
        )
        assert r.status_code == 201, r.text
        goal = r.json()["goal"]
        assert goal["goalkeeper"]["display_name"] == "P3"
        # Avatar resolved in the same payload (no second lookup needed).
        assert "avatar_url" in goal["goalkeeper"]

        # Shown in the public goal log too.
        rp = await ac.get(f"/meetups/{sid}/matches/{mid}/goals", headers=hdr("p1"))
        assert rp.status_code == 200
        rows = rp.json()["goals"]
        assert len(rows) == 1
        assert rows[0]["goalkeeper"]["display_name"] == "P3"

        # Stored on the row.
        async with AsyncSession(engine) as db:
            g = await db.get(MatchGoal, goal["id"])
            assert g is not None
            assert g.goalkeeper_id == ids["p3"]


@pytest.mark.asyncio
async def test_keeper_from_scoring_team_refused():
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, TOKENS)
        assert (
            await ac.post(f"/meetups/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        # P1 is on the scoring team (A) — cannot be the beaten keeper.
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p2"],
                "goalkeeper_id": ids["p1"],
                "intent_id": "gk-2",
            },
            headers=hdr("p1"),
        )
        assert r.status_code == 400, r.text
        assert "conceding" in r.json()["detail"].lower()
        # Nothing was stored.
        rp = await ac.get(f"/meetups/{sid}/matches/{mid}/goals", headers=hdr("p1"))
        assert rp.json()["goals"] == []


@pytest.mark.asyncio
async def test_keeper_equal_scorer_or_assist_refused():
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, TOKENS)
        assert (
            await ac.post(f"/meetups/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        # Keeper == scorer (scorer is on A, so use an A player as keeper).
        r1 = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p2"],
                "goalkeeper_id": ids["p2"],
                "intent_id": "gk-3",
            },
            headers=hdr("p1"),
        )
        assert r1.status_code == 400
        assert "not the scorer" in r1.json()["detail"].lower()

        # Keeper == assist (assist on B, keeper offered on B too).
        r2 = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p2"],
                "assist_id": ids["p3"],
                "goalkeeper_id": ids["p3"],
                "intent_id": "gk-4",
            },
            headers=hdr("p1"),
        )
        assert r2.status_code == 400
        assert "not the assist" in r2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_keeper_omitted_stays_null():
    """Unknown/rotated keeper must never block entry — field is optional."""
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, TOKENS)
        assert (
            await ac.post(f"/meetups/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={"team": "a", "scorer_id": ids["p2"], "intent_id": "gk-5"},
            headers=hdr("p1"),
        )
        assert r.status_code == 201, r.text
        assert r.json()["goal"]["goalkeeper"] is None


@pytest.mark.asyncio
async def test_keeper_unknown_user_refused():
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, TOKENS)
        assert (
            await ac.post(f"/meetups/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p2"],
                "goalkeeper_id": 99999,
                "intent_id": "gk-6",
            },
            headers=hdr("p1"),
        )
        assert r.status_code == 400
        assert r.json()["detail"] == "Goalkeeper is not in this meetup"
        # viewer: provisioned account that never joined this meetup —
        # also "not in this meetup". Hit a JWT-only endpoint first so the
        # JIT provisioning path creates the user row, then look up its id.
        probe = await ac.get("/meetups/", headers=hdr("viewer"))
        assert probe.status_code == 200
        async with AsyncSession(engine) as db:
            vrow = (
                await db.execute(
                    select(User).where(User.pocket_id_sub == "viewer-uuid")
                )
            ).scalar_one()
        r3 = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p2"],
                "goalkeeper_id": vrow.id,
                "intent_id": "gk-7",
            },
            headers=hdr("p1"),
        )
        assert r3.status_code == 400
        assert r3.json()["detail"] == "Goalkeeper is not in this meetup"


@pytest.mark.asyncio
async def test_keeper_preserved_on_intent_replay():
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, TOKENS)
        assert (
            await ac.post(f"/meetups/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        body = {
            "team": "a",
            "scorer_id": ids["p2"],
            "goalkeeper_id": ids["tp1"],
            "intent_id": "gk-replay",
        }
        r1 = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals", json=body, headers=hdr("p1")
        )
        assert r1.status_code == 201
        goal = r1.json()["goal"]
        # conftest _TOKEN_MAP defines tp1's display name as "TP1".
        assert goal["goalkeeper"]["display_name"] == "TP1"

        # Retry with the same intent: replay returns the same row, same keeper.
        r2 = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals", json=body, headers=hdr("p1")
        )
        assert r2.status_code == 200
        assert r2.json()["replayed"] is True
        assert r2.json()["goal"]["id"] == goal["id"]
        assert r2.json()["goal"]["goalkeeper"]["display_name"] == "TP1"


@pytest.mark.asyncio
async def test_own_goal_scorer_must_be_on_conceding_team():
    """Own goal for team A: the scorer is the player who put it in B's net."""
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, TOKENS)
        assert (
            await ac.post(f"/meetups/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        # P2 is on the scoring team (A) — refused as an own-goal scorer.
        r1 = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p2"],
                "is_own_goal": True,
                "intent_id": "og-1",
            },
            headers=hdr("p1"),
        )
        assert r1.status_code == 400
        assert "conceding" in r1.json()["detail"].lower()

        # P3 is on the conceding team (B) — accepted, stored, and shown.
        r2 = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p3"],
                "is_own_goal": True,
                "intent_id": "og-2",
            },
            headers=hdr("p1"),
        )
        assert r2.status_code == 201, r2.text
        assert r2.json()["goal"]["is_own_goal"] is True
        rp = await ac.get(f"/meetups/{sid}/matches/{mid}/goals", headers=hdr("p1"))
        assert rp.json()["goals"][0]["is_own_goal"] is True


@pytest.mark.asyncio
async def test_normal_goal_scorer_must_be_on_scoring_team():
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, TOKENS)
        assert (
            await ac.post(f"/meetups/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        # P3 is on the opposing team — cannot score a regular goal for A.
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={"team": "a", "scorer_id": ids["p3"], "intent_id": "og-3"},
            headers=hdr("p1"),
        )
        assert r.status_code == 400
        assert "scoring" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_is_own_goal_migration_adds_column():
    """A match_goals table from an earlier deploy (no is_own_goal) gets it."""
    async with engine.begin() as conn:
        await conn.execute(text("DROP TABLE IF EXISTS match_goals"))
        await conn.execute(
            text(
                "CREATE TABLE match_goals (id INTEGER PRIMARY KEY, match_id INTEGER,"
                " team VARCHAR, scorer_id INTEGER, assist_id INTEGER,"
                " goalkeeper_id INTEGER, clock_secs INTEGER, clock_minute INTEGER,"
                " after_whistle INTEGER, recorded_by INTEGER,"
                " intent_id VARCHAR UNIQUE, created_at TIMESTAMP, deleted_at TIMESTAMP)"
            )
        )
        await run_sqlite_migrations(conn)
        cols = [c[1] for c in (await conn.execute(text("PRAGMA table_info(match_goals)"))).fetchall()]
        assert "is_own_goal" in cols
