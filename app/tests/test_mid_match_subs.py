"""Mid-match substitutions: only while the timer is paused, clocked,
match-local (no partition propagation), and the roster updates."""

from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.match import MatchSubstitution
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


async def make_running_match(ac: AsyncClient):
    """Meetup with two teams + a bench player; match 1 started."""
    start = datetime.now(UTC).replace(tzinfo=None)
    r = await ac.post(
        "/meetups/",
        json={
            "start_time": start.isoformat(),
            "location": "Pitch",
            "min_players": 1,
            "max_players": 4,
            "max_teams": 2,
            "send_push_notifications": False,
        },
        headers=hdr("admin"),
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]

    for token in ("p1", "p2", "p3", "p4"):
        rj = await ac.post(f"/meetups/{sid}/join", headers=hdr(token))
        assert rj.status_code == 200, rj.text

    async with AsyncSession(engine) as db:
        ids = {
            token: (
                await db.execute(
                    select(User).where(User.pocket_id_sub == f"{token}-uuid")
                )
            ).scalar_one().id
            for token in ("p1", "p2", "p3", "p4")
        }

    # p1 attends AND administers: the swap is admin-gated but lease-held,
    # and the lease only goes to present members.
    r = await ac.patch(
        f"/users/{ids['p1']}", json={"is_admin": True}, headers=hdr("admin")
    )
    assert r.status_code == 200, r.text

    teams = [
        [str(ids["p1"]), str(ids["p2"])],
        [str(ids["p3"]), str(ids["p4"])],
    ]
    rt = await ac.patch(
        f"/meetups/{sid}/teams", json={"teams": teams}, headers=hdr("admin")
    )
    assert rt.status_code == 200, rt.text

    async with AsyncSession(engine) as db:
        mup = await db.get(Meetup, sid)

    rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admin"))
    assert rs.status_code == 201, rs.text
    mid = rs.json()["match"]["id"]

    rs = await ac.post(
        f"/meetups/{sid}/matches/{mid}/timer/start", headers=hdr("p1")
    )
    assert rs.status_code == 200, rs.text

    # One-writer gate for the swap endpoint (same lease as goal entry).
    rl = await ac.post(
        f"/meetups/{sid}/matches/lease/acquire?match_id={mid}", headers=hdr("p1")
    )
    assert rl.status_code == 200, rl.text

    return sid, mid, ids, mup.manual_teams_json


@pytest.mark.asyncio
async def test_swap_blocked_while_timer_runs():
    async with await client() as ac:
        sid, mid, ids, _ = await make_running_match(ac)
        r = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json={
                "team_a_users": [ids["p1"], ids["p3"]],
                "team_b_users": [ids["p2"], ids["p4"]],
            },
            headers=hdr("p1"),
        )
        assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_swap_mid_match_records_clock_and_stays_match_local():
    async with await client() as ac:
        sid, mid, ids, partition_before = await make_running_match(ac)
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/timer/pause", headers=hdr("p1")
        )
        assert r.status_code == 200, r.text

        # Cross-team swap, sizes preserved.
        r = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json={
                "team_a_users": [ids["p1"], ids["p3"]],
                "team_b_users": [ids["p2"], ids["p4"]],
            },
            headers=hdr("p1"),
        )
        assert r.status_code == 200, r.text
        assert {u["id"] for u in r.json()["team_a"]["users"]} == {ids["p1"], ids["p3"]}

        async with AsyncSession(engine) as db:
            m = (
                await db.execute(select(Meetup).where(Meetup.id == sid))
            ).scalar_one()
            subs = (
                (
                    await db.execute(
                        select(MatchSubstitution).where(
                            MatchSubstitution.match_id == mid
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert len(subs) == 1
        assert subs[0].clock_secs is not None
        assert subs[0].clock_secs >= 0
        # Match-local: the meetup partition is untouched (no propagation).
        assert m.manual_teams_json == partition_before

        # The substitution history endpoint carries the clock.
        r = await ac.get(
            f"/meetups/{sid}/matches/{mid}/substitutions", headers=hdr("p1")
        )
        assert r.status_code == 200
        assert r.json()["substitutions"][0]["clock_secs"] == subs[0].clock_secs
