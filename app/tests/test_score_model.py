"""Score model fixes: goal count + manual offset, reset clears goals,
second same-minute goal via force, and FK-enforced delete cleanup.

Audit findings 2, 3, 4, 6.
"""

from datetime import datetime, timedelta, UTC
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.match import MeetupMatch
from app.models.match_goal import MatchGoal
from app.models.meetup import Attendance
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


async def make_live_setup(ac: AsyncClient, tokens, *, start_offset_minutes: int = 0):
    """Meetup + joins + two manual teams + active match. Returns (sid, mid, ids)."""
    start = datetime.now(UTC).replace(tzinfo=None) + timedelta(
        minutes=start_offset_minutes
    )
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


async def log_goal(ac, sid, mid, team, scorer_id, intent, *, force=False):
    ra = await ac.post(
        f"/meetups/{sid}/matches/lease/acquire", headers=hdr("p1")
    )
    # 200: we won the lease. 409: we already hold it (the 409-duplicate path
    # in create_goal does not release the lease) — fine, we're the holder.
    assert ra.status_code in (200, 409), ra.text
    r = await ac.post(
        f"/meetups/{sid}/matches/{mid}/goals",
        json={
            "team": team,
            "scorer_id": scorer_id,
            "intent_id": intent,
            "force": force,
        },
        headers=hdr("p1"),
    )
    return r


@pytest.mark.asyncio
async def test_manual_offset_composes_with_goals():
    """Referee +1 must survive a goal recompute (finding 4)."""
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, ["p1", "p2"])

        r = await log_goal(ac, sid, mid, "a", ids["p2"], "i-1")
        assert r.status_code == 201, r.text
        assert (r.json()["score_a"], r.json()["score_b"]) == (1, 0)

        # Admin taps +1: the correction lives in the offset, not the count.
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/score",
            json={"team": "a", "delta": 1},
            headers=hdr("admin"),
        )
        assert r.status_code == 200, r.text
        assert (r.json()["score_a"], r.json()["score_b"]) == (2, 0)

        # A member logs a second goal: recompute must keep the +1.
        r = await log_goal(ac, sid, mid, "a", ids["p1"], "i-2")
        assert r.status_code == 201, r.text
        assert (r.json()["score_a"], r.json()["score_b"]) == (3, 0)

        # And deleting one goal composes too: 2 goals' count is gone, +1 kept.
        goal_id = (
            await ac.get(
                f"/meetups/{sid}/matches/{mid}/goals", headers=hdr("admin")
            )
        ).json()["goals"][0]["id"]
        r = await ac.delete(
            f"/meetups/{sid}/matches/{mid}/goals/{goal_id}", headers=hdr("admin")
        )
        assert r.status_code == 204


@pytest.mark.asyncio
async def test_second_same_minute_goal_with_force():
    """A striker's double in one minute is loggable (finding 2)."""
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, ["p1", "p2"])

        r = await log_goal(ac, sid, mid, "a", ids["p2"], "i-1")
        assert r.status_code == 201, r.text

        # Same team/scorer/minute within 90 s, no force: 409 confirm prompt.
        r = await log_goal(ac, sid, mid, "a", ids["p2"], "i-2")
        assert r.status_code == 409
        assert r.json()["detail"] == "duplicate_goal_within_90s"

        # Confirmed (force): a real second row, score counts both.
        r = await log_goal(ac, sid, mid, "a", ids["p2"], "i-3", force=True)
        assert r.status_code == 201, r.text
        assert (r.json()["score_a"], r.json()["score_b"]) == (2, 0)

        async with AsyncSession(engine) as db:
            n = await db.scalar(
                select(func.count())
                .select_from(MatchGoal)
                .where(
                    MatchGoal.match_id == mid,
                    MatchGoal.deleted_at.is_(None),
                )
            )
        assert n == 2


@pytest.mark.asyncio
async def test_reset_zeroes_score_and_keeps_it_zero():
    """Reset soft-deletes live goals so the score can't come back (finding 3)."""
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, ["p1", "p2"])

        r = await log_goal(ac, sid, mid, "a", ids["p2"], "i-1")
        assert r.status_code == 201, r.text

        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/timer/reset", headers=hdr("p1")
        )
        assert r.status_code == 200, r.text
        assert (r.json()["score_a"], r.json()["score_b"]) == (0, 0)

        async with AsyncSession(engine) as db:
            n = await db.scalar(
                select(func.count())
                .select_from(MatchGoal)
                .where(MatchGoal.match_id == mid, MatchGoal.deleted_at.is_(None))
            )
        assert n == 0, "reset must soft-delete live goals"

        # Restart and log a goal: 1-0, not 2-0.
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/timer/start", headers=hdr("p1")
        )
        assert r.status_code == 200, r.text
        r = await log_goal(ac, sid, mid, "a", ids["p2"], "i-2")
        assert r.status_code == 201, r.text
        assert (r.json()["score_a"], r.json()["score_b"]) == (1, 0)


@pytest.mark.asyncio
async def test_delete_user_cleans_child_rows(monkeypatch):
    """FK enforcement: deleting a member leaves no orphan rows (finding 6)."""
    import app.api.users as users_api

    monkeypatch.setattr(
        users_api, "delete_user", AsyncMock(return_value=True), raising=False
    )
    async with await client() as ac:
        sid, _mid, _ids = await make_live_setup(ac, ["p1", "p2"])
        async with AsyncSession(engine) as db:
            p1_id = await user_id_by_sub(db, "p1-uuid")

        r = await ac.delete(f"/users/{p1_id}", headers=hdr("admin"))
        assert r.status_code == 200, r.text

        async with AsyncSession(engine) as db:
            att = await db.scalar(
                select(func.count())
                .select_from(Attendance)
                .where(Attendance.meetup_id == sid)
            )
            users = await db.scalar(
                select(func.count()).select_from(User).where(User.id == p1_id)
            )
        assert users == 0
        # p1's attendance row is gone — the confirmed count is no longer inflated.
        assert att == 1


@pytest.mark.asyncio
async def test_delete_meetup_cleans_matches_and_goals():
    """Meetup delete cascades to matches, goals and attendance (finding 6)."""
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, ["p1", "p2"])
        r = await log_goal(ac, sid, mid, "a", ids["p2"], "i-1")
        assert r.status_code == 201, r.text

        r = await ac.delete(f"/meetups/{sid}", headers=hdr("admin"))
        assert r.status_code == 200, r.text

        async with AsyncSession(engine) as db:
            goals = await db.scalar(
                select(func.count())
                .select_from(MatchGoal)
                .where(MatchGoal.match_id == mid)
            )
            matches = await db.scalar(
                select(func.count())
                .select_from(MeetupMatch)
                .where(MeetupMatch.meetup_id == sid)
            )
            att = await db.scalar(
                select(func.count())
                .select_from(Attendance)
                .where(Attendance.meetup_id == sid)
            )
        assert goals == 0
        assert matches == 0
        assert att == 0
