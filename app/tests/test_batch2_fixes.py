"""Batch 2 fixes: waitlist promotion on admin move, min/max patch validation,
lease holder re-claim, race-safe pause, double-end guard."""

from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.match import SessionMatch
from app.models.session import Attendance
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


async def make_session(
    ac: AsyncClient,
    *,
    tokens,
    max_players: int,
    min_players: int = 1,
    with_match: bool = False,
):
    start = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=0)
    r = await ac.post(
        "/sessions/",
        json={
            "start_time": start.isoformat(),
            "location": "Pitch",
            "min_players": min_players,
            "max_players": max_players,
            "send_push_notifications": False,
        },
        headers=hdr("admin"),
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    for t in tokens:
        rj = await ac.post(f"/sessions/{sid}/join", headers=hdr(t))
        assert rj.status_code == 200, rj.text

    if not with_match:
        return sid

    async with AsyncSession(engine) as db:
        ids = {
            t: (
                await db.execute(select(User).where(User.pocket_id_sub == f"{t}-uuid"))
            )
            .scalar_one()
            .id
            for t in tokens
        }
    half = max(len(tokens) // 2, 1)
    teams = [
        [str(ids[t]) for t in tokens[:half]],
        [str(ids[t]) for t in tokens[half:]],
    ]
    rt = await ac.patch(
        f"/sessions/{sid}/teams", json={"teams": teams}, headers=hdr("admin")
    )
    assert rt.status_code == 200, rt.text

    rs = await ac.post(f"/sessions/{sid}/matches/start", headers=hdr("admin"))
    assert rs.status_code == 201, rs.text
    mid = rs.json()["match"]["id"]
    async with AsyncSession(engine) as db:
        m = (
            await db.execute(select(SessionMatch).where(SessionMatch.id == mid))
        ).scalar_one()
        m.timer_started_at = datetime.now(UTC)
        m.timer_seconds_remaining = m.timer_total_seconds
        m.status = "active"
        await db.commit()
    return sid, mid


@pytest.mark.asyncio
async def test_new_pending_match_requires_both_team_indices():
    """Tail B: exactly one of team_a_idx/team_b_idx is a client bug, not a
    silent 'pick the rest' decision."""
    async with await client() as ac:
        sid = await make_session(ac, tokens=["p1", "p2"], max_players=4)
        r = await ac.post(
            f"/sessions/{sid}/matches/new",
            json={"team_a_idx": 0},
            headers=hdr("admin"),
        )
        assert r.status_code == 400, r.text
        r2 = await ac.post(
            f"/sessions/{sid}/matches/new",
            json={"team_b_idx": 1},
            headers=hdr("admin"),
        )
        assert r2.status_code == 400, r2.text


@pytest.mark.asyncio
async def test_admin_move_demoting_confirmed_promotes_waitlist():
    """Finding 8: a demoted confirmed spot is an open spot."""
    async with await client() as ac:
        sid = await make_session(ac, tokens=["p1", "p2", "p3"], max_players=2)

        async def statuses() -> dict[int, str]:
            async with AsyncSession(engine) as db:
                rows = (
                    (
                        await db.execute(
                            select(Attendance).where(
                                Attendance.session_id == sid
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
            return {a.user_id: a.status for a in rows}

        before = await statuses()
        # p1, p2 confirmed (join order, capacity 2); p3 waitlisted.
        assert sum(1 for s in before.values() if s == "confirmed") == 2
        demote_target = min(
            u for u, s in before.items() if s == "confirmed"
        )
        waitlisted_before = [u for u, s in before.items() if s == "waitlisted"]
        r = await ac.post(
            f"/sessions/{sid}/admin/move?user_id={demote_target}&new_status=waitlisted",
            headers=hdr("admin"),
        )
        assert r.status_code == 200, r.text

        after = await statuses()
        assert after[demote_target] == "waitlisted"
        # The open spot went to the first waitlisted player (p3).
        promoted = [u for u, s in after.items() if s == "confirmed"]
        assert len(promoted) == 2
        assert demote_target not in promoted
        # The previously-waitlisted player (p3) took the open spot.
        assert set(waitlisted_before) <= set(promoted)


@pytest.mark.asyncio
async def test_update_session_rejects_max_below_min():
    """Finding 9: the patch endpoint enforces the same cross-field rule."""
    async with await client() as ac:
        sid = await make_session(ac, tokens=["p1"], max_players=10, min_players=5)
        r = await ac.patch(
            f"/sessions/{sid}",
            json={"max_players": 4},
            headers=hdr("admin"),
        )
        assert r.status_code == 400
        # And a consistent update still works.
        r = await ac.patch(
            f"/sessions/{sid}",
            json={"max_players": 6},
            headers=hdr("admin"),
        )
        assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_lease_holder_reclaim_gets_fresh_token():
    """Finding 12: re-claiming your own lease is not a 409 naming yourself."""
    async with await client() as ac:
        sid, m = await make_session(
            ac, tokens=["p1", "p2"], max_players=4, with_match=True
        )

        r1 = await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p1"))
        assert r1.status_code == 200
        tok1 = r1.json()["lease_token"]

        # Same holder, double-open of the sheet: fresh token, not a 409.
        r2 = await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p1"))
        assert r2.status_code == 200, r2.text
        assert r2.json()["lease_token"] != tok1

        # Someone else still loses the race: 409 naming the holder.
        r3 = await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p2"))
        assert r3.status_code == 409
        assert r3.json()["holder_name"] == "P1"


@pytest.mark.asyncio
async def test_double_pause_appends_one_interval():
    """Finding 13: a racing/second pause tap cannot open a second interval."""
    async with await client() as ac:
        sid, mid = await make_session(
            ac, tokens=["p1", "p2"], max_players=4, with_match=True
        )

        r1 = await ac.post(f"/sessions/{sid}/matches/{mid}/timer/pause", headers=hdr("p1"))
        assert r1.status_code == 200, r1.text
        assert r1.json()["already"] is False
        r2 = await ac.post(f"/sessions/{sid}/matches/{mid}/timer/pause", headers=hdr("p1"))
        assert r2.status_code == 200, r2.text
        assert r2.json()["already"] is True

        async with AsyncSession(engine) as db:
            res = await db.execute(
                select(SessionMatch).where(SessionMatch.id == mid)
            )
            m2 = res.scalar_one()
            import json

            intervals = json.loads(m2.timer_pause_intervals)
        open_intervals = [i for i in intervals if i["resumed_at"] is None]
        assert len(open_intervals) == 1


@pytest.mark.asyncio
async def test_end_match_twice_is_409():
    """Finding 11: the completion guard makes a second /end a 409."""
    async with await client() as ac:
        sid, mid = await make_session(
            ac, tokens=["p1", "p2"], max_players=4, with_match=True
        )
        async with AsyncSession(engine) as db:
            res = await db.execute(
                select(SessionMatch).where(SessionMatch.id == mid)
            )
            mm = res.scalar_one()
            mm.score_a = 1
            await db.commit()

        r1 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/end",
            json={},
            headers=hdr("admin"),
        )
        assert r1.status_code == 200, r1.text
        r2 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/end",
            json={},
            headers=hdr("admin"),
        )
        assert r2.status_code == 409
