"""Mid-meetup team reshape: N teams of M players; leftovers form ONE bench
team (no "not on a team" category). Reshaped teams get FRESH names.

Covers the trust boundary (capacity, admin-only), the partition rewrite with
a bench team, pending-match propagation, and bench-player substitutions.
"""

import json
from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.core.timeutil import utcnow
from app.models.match import MeetupMatch
from app.models.match_editor_lease import MatchEditorLease
from app.models.meetup import Meetup
from app.models.user import User

TOKENS = [f"p{i}" for i in range(1, 13)]


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


async def create_test_user(
    db: AsyncSession, display_name: str, pocket_id_sub: str, is_admin: bool = False
) -> User:
    user = User(
        pocket_id_sub=pocket_id_sub, sso_display_name=display_name, is_admin=is_admin
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def user_id_by_sub(pocket_id_sub: str) -> int:
    async with AsyncSession(engine) as db:
        res = await db.execute(
            select(User).where(User.pocket_id_sub == pocket_id_sub)
        )
        return res.scalar_one().id


async def make_meetup_with_pending_match(ac: AsyncClient) -> int:
    async with AsyncSession(engine) as db:
        await create_test_user(db, "Admint", "admint-uuid", is_admin=True)
        for n in TOKENS:
            await create_test_user(db, n.upper(), f"{n}-uuid")
    start = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=5)
    r = await ac.post(
        "/meetups/",
        json={
            "start_time": start.isoformat(),
            "location": "Pitch",
            "min_players": 1,
            "max_players": 20,
            "send_push_notifications": False,
        },
        headers=hdr("admint"),
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    for t in TOKENS:
        rj = await ac.post(f"/meetups/{sid}/join", headers=hdr(t))
        assert rj.status_code == 200, rj.text
    rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
    assert rs.status_code == 201, rs.text
    return sid


async def pending_match(ac: AsyncClient, sid: int) -> dict:
    rm = await ac.get(f"/meetups/{sid}/matches", headers=hdr("admint"))
    return [x for x in rm.json()["matches"] if x["status"] == "pending"][0]


async def hold_lease(match_id: int, user_id: int) -> None:
    async with AsyncSession(engine) as db:
        db.add(
            MatchEditorLease(
                match_id=match_id,
                holder_id=user_id,
                expires_at=utcnow() + timedelta(seconds=45),
                release_token="t",
            )
        )
        await db.commit()


@pytest.mark.asyncio
async def test_reshape_2x6_fresh_names_no_bench():
    async with await client() as ac:
        sid = await make_meetup_with_pending_match(ac)
        rt = await ac.get(f"/meetups/{sid}/teams", headers=hdr("admint"))
        old_names = [t["name"] for t in rt.json()["teams"]]

        r = await ac.post(
            f"/meetups/{sid}/teams/reshape",
            json={"team_count": 2, "team_size": 6},
            headers=hdr("admint"),
        )
        assert r.status_code == 200, r.text
        teams = r.json()["teams"]
        # No bench: exactly 2 teams of 6, everyone placed.
        assert [len(t["players"]) for t in teams] == [6, 6]
        flat = [int(p["id"]) for t in teams for p in t["players"]]
        assert len(flat) == len(set(flat)) == 12
        # Fresh names: the new lineup is a new team (Theseus).
        new_names = [t["name"] for t in teams]
        assert new_names != old_names

        async with AsyncSession(engine) as db:
            m = await db.get(Meetup, sid)
            assert m.max_teams == 2
            assert json.loads(m.team_names_json) == new_names
            partition = json.loads(m.manual_teams_json)
            assert len(partition) == 2 and all(len(t) == 6 for t in partition)

        # Pending match rewritten to the new partition's first two teams.
        pm = await pending_match(ac, sid)
        mids = [u["id"] for u in pm["team_a"]["users"] + pm["team_b"]["users"]]
        assert len(set(mids)) == 12
        assert pm["team_a"]["name"] == new_names[0]
        assert pm["team_b"]["name"] == new_names[1]


@pytest.mark.asyncio
async def test_reshape_2x5_bench_team_visible_and_swappable():
    async with await client() as ac:
        sid = await make_meetup_with_pending_match(ac)
        r = await ac.post(
            f"/meetups/{sid}/teams/reshape",
            json={"team_count": 2, "team_size": 5},
            headers=hdr("admint"),
        )
        assert r.status_code == 200, r.text
        teams = r.json()["teams"]
        # 2×5 playing + ONE bench team of 2 (incomplete is fine).
        assert len(teams) == 3
        assert sorted(len(t["players"]) for t in teams) == [2, 5, 5]
        flat = [int(p["id"]) for t in teams for p in t["players"]]
        assert len(flat) == len(set(flat)) == 12

        # GET /teams shows all three (the bench is a team, not a category).
        rt = await ac.get(f"/meetups/{sid}/teams", headers=hdr("admint"))
        tflat = [int(p["id"]) for t in rt.json()["teams"] for p in t["players"]]
        assert len(tflat) == len(set(tflat)) == 12

        # Pending match is 5v5 from the first two teams.
        pm = await pending_match(ac, sid)
        a = [u["id"] for u in pm["team_a"]["users"]]
        b = [u["id"] for u in pm["team_b"]["users"]]
        assert len(a) == len(b) == 5
        # The two bench players are the ones NOT in the pending match.
        bench = [p for p in flat if p not in a and p not in b]
        assert len(bench) == 2

        # Bench player swaps into the match (two-tap 1-for-1) → 200.
        await hold_lease(pm["id"], await user_id_by_sub("admint-uuid"))
        new_a = a[:-1] + [bench[0]]
        new_b = b[:-1] + [a[-1]]
        rs = await ac.patch(
            f"/meetups/{sid}/matches/{pm['id']}/teams",
            json={"team_a_users": new_a, "team_b_users": new_b},
            headers=hdr("admint"),
        )
        assert rs.status_code == 200, rs.text


@pytest.mark.asyncio
async def test_reshape_rejects_capacity_and_non_admin():
    async with await client() as ac:
        sid = await make_meetup_with_pending_match(ac)

        # 2 × 8 = 16 > 12 confirmed.
        r = await ac.post(
            f"/meetups/{sid}/teams/reshape",
            json={"team_count": 2, "team_size": 8},
            headers=hdr("admint"),
        )
        assert r.status_code == 400

        # Non-admin cannot reshape.
        r3 = await ac.post(
            f"/meetups/{sid}/teams/reshape",
            json={"team_count": 2, "team_size": 6},
            headers=hdr("p1"),
        )
        assert r3.status_code == 403
