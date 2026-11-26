"""Regulation-time penalties, kept separate from ordinary goals.

- Penalty goal: counts toward the score/winner, never toward the goals
  ranking; no assist (forced None); own goal + penalty rejected.
- Missed penalty: no goal row, no score change, lease released, counted in
  penalties_taken (not scored); deletable; intent replay is idempotent.
"""

from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.match import MeetupMatch, PenaltyMiss
from app.models.match_goal import MatchGoal
from app.models.meetup import Meetup
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
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def user_id_by_sub(db, sub: str) -> int:
    res = await db.execute(select(User).where(User.pocket_id_sub == sub))
    return res.scalar_one().id


async def make_setup(ac: AsyncClient, tokens=("p1", "p2")):
    """Meetup + joins + two manual teams + match 1 active. Returns (sid, mid, ids)."""
    start = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)
    r = await ac.post(
        "/meetups/",
        json={
            "start_time": start.isoformat(),
            "location": "Pitch",
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

    async with AsyncSession(engine) as db:
        ids = {t: await user_id_by_sub(db, f"{t}-uuid") for t in tokens}
        await db.execute(
            update(Meetup)
            .where(Meetup.id == sid)
            .values(
                start_time=datetime.now(UTC).replace(tzinfo=None)
                - timedelta(minutes=15)
            )
        )
        await db.commit()

    half = max(len(tokens) // 2, 1)
    teams = [
        [str(ids[t]) for t in tokens[:half]],
        [str(ids[t]) for t in tokens[half:]],
    ]
    rt = await ac.patch(
        f"/meetups/{sid}/teams", json={"teams": teams}, headers=hdr("admin")
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


async def acquire(ac: AsyncClient, sid: int, token: str):
    r = await ac.post(f"/meetups/{sid}/matches/lease/acquire", headers=hdr(token))
    assert r.status_code == 200, r.text


async def end_match(ac: AsyncClient, sid: int, mid: int):
    r = await ac.post(
        f"/meetups/{sid}/matches/{mid}/end", json={}, headers=hdr("admin")
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_penalty_goal_counts_score_but_not_goals_ranking():
    async with await client() as ac:
        sid, mid, ids = await make_setup(ac, ["p1", "p2", "p3"])
        await acquire(ac, sid, "p1")
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p1"],
                "assist_id": ids["p3"],  # forced to None for penalties
                "is_penalty": True,
                "intent_id": "pen-1",
            },
            headers=hdr("p1"),
        )
        assert r.status_code == 201, r.text
        goal = r.json()["goal"]
        assert goal["is_penalty"] is True
        assert goal["assist"] is None
        assert goal["scorer"]["display_name"] == "P1"
        assert r.json()["score_a"] == 1

        # Penalty goal counts toward the score but not the goals ranking.
        await end_match(ac, sid, mid)
        resp = await ac.get("/rankings?year=2026&sort=goals", headers=hdr("p1"))
        assert resp.status_code == 200, resp.text
        row = {r["user"]["id"]: r for r in resp.json()["rows"]}[ids["p1"]]
        assert row["goals"] == 0
        assert row["penalties_taken"] == 1 and row["penalties_scored"] == 1


@pytest.mark.asyncio
async def test_penalty_own_goal_rejected():
    async with await client() as ac:
        sid, mid, ids = await make_setup(ac, ["p1", "p2", "p3"])
        await acquire(ac, sid, "p1")
        # Scorer on the conceding team + own goal + penalty → 400.
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p3"],
                "is_own_goal": True,
                "is_penalty": True,
                "intent_id": "pen-og",
            },
            headers=hdr("p1"),
        )
        assert r.status_code == 400
        assert "own goal" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_missed_penalty_records_miss_not_goal():
    async with await client() as ac:
        sid, mid, ids = await make_setup(ac, ["p1", "p2", "p3"])
        await acquire(ac, sid, "p1")
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p1"],
                "is_penalty": True,
                "missed": True,
                "intent_id": "miss-1",
            },
            headers=hdr("p1"),
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["miss"]["scorer"]["display_name"] == "P1"
        assert body["miss"]["team"] == "a"
        assert body["replayed"] is False
        # Nothing in the match: no goal, no score change.
        assert body["score_a"] == 0
        async with AsyncSession(engine) as db:
            goals = (
                (await db.execute(select(MatchGoal).where(MatchGoal.match_id == mid)))
                .scalars()
                .all()
            )
            assert goals == []
            misses = (
                (
                    await db.execute(
                        select(PenaltyMiss).where(PenaltyMiss.match_id == mid)
                    )
                )
                .scalars()
                .all()
            )
            assert len(misses) == 1
            assert misses[0].scorer_id == ids["p1"]
            assert misses[0].intent_id == "miss-1"

        # The miss counts in penalties_taken, not scored.
        await end_match(ac, sid, mid)
        resp = await ac.get(
            "/rankings?year=2026&sort=penalties_taken", headers=hdr("p1")
        )
        assert resp.status_code == 200, resp.text
        row = {r["user"]["id"]: r for r in resp.json()["rows"]}[ids["p1"]]
        assert row["penalties_taken"] == 1 and row["penalties_scored"] == 0

        # Replay with the same intent returns the stored miss (200).
        r2 = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p1"],
                "is_penalty": True,
                "missed": True,
                "intent_id": "miss-1",
            },
            headers=hdr("p1"),
        )
        assert r2.status_code == 200
        assert r2.json()["replayed"] is True
        assert r2.json()["miss"]["id"] == body["miss"]["id"]

        # The misses list endpoint returns it.
        r3 = await ac.get(
            f"/meetups/{sid}/matches/{mid}/penalty-misses", headers=hdr("p1")
        )
        assert r3.status_code == 200
        assert [m["id"] for m in r3.json()["misses"]] == [body["miss"]["id"]]


@pytest.mark.asyncio
async def test_miss_requires_lease():
    async with await client() as ac:
        sid, mid, ids = await make_setup(ac, ["p1", "p2"])
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p1"],
                "is_penalty": True,
                "missed": True,
                "intent_id": "miss-lease",
            },
            headers=hdr("p1"),
        )
        assert r.status_code == 409


@pytest.mark.asyncio
async def test_delete_miss_removes_it():
    async with await client() as ac:
        sid, mid, ids = await make_setup(ac, ["p1", "p2", "p3"])
        await acquire(ac, sid, "p1")
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p1"],
                "is_penalty": True,
                "missed": True,
                "intent_id": "miss-del",
            },
            headers=hdr("p1"),
        )
        assert r.status_code == 201, r.text
        miss_id = r.json()["miss"]["id"]

        await end_match(ac, sid, mid)
        resp = await ac.get(
            "/rankings?year=2026&sort=penalties_taken", headers=hdr("p1")
        )
        row = {r["user"]["id"]: r for r in resp.json()["rows"]}[ids["p1"]]
        assert row["penalties_taken"] == 1

        d = await ac.delete(
            f"/meetups/{sid}/matches/{mid}/penalty-misses/{miss_id}",
            headers=hdr("admin"),
        )
        assert d.status_code == 204
        async with AsyncSession(engine) as db:
            misses = (
                (
                    await db.execute(
                        select(PenaltyMiss).where(PenaltyMiss.match_id == mid)
                    )
                )
                .scalars()
                .all()
            )
            assert misses == []
        resp = await ac.get(
            "/rankings?year=2026&sort=penalties_taken", headers=hdr("p1")
        )
        row = {r["user"]["id"]: r for r in resp.json()["rows"]}[ids["p1"]]
        assert row["penalties_taken"] == 0


@pytest.mark.asyncio
async def test_miss_own_goal_rejected():
    async with await client() as ac:
        sid, mid, ids = await make_setup(ac, ["p1", "p2", "p3"])
        await acquire(ac, sid, "p1")
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p3"],
                "is_own_goal": True,
                "is_penalty": True,
                "missed": True,
                "intent_id": "miss-og",
            },
            headers=hdr("p1"),
        )
        assert r.status_code == 400
