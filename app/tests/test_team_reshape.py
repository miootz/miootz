"""Team capacity, waitlist changes, and match-safe reshaping."""

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
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.services.rating_settings import RatingSettings

TOKENS = [f"p{i}" for i in range(1, 13)]


@pytest.fixture(scope="function", autouse=True)
async def setup_db(monkeypatch):
    # Keep the roster names fixed while comparing repeated team payloads.
    monkeypatch.setattr("app.api.middleware._background_sync_sso", lambda *_: None)
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


async def mark_started(sid: int) -> None:
    async with AsyncSession(engine) as db:
        original = (await db.execute(
            select(MeetupMatch).where(MeetupMatch.meetup_id == sid)
        )).scalar_one()
        original.status = "active"
        for number, status in [(2, "completed"), (3, "pending")]:
            db.add(MeetupMatch(
                meetup_id=sid,
                match_number=number,
                status=status,
                team_a_users=original.team_a_users,
                team_b_users=original.team_b_users,
                team_a_name=original.team_a_name,
                team_b_name=original.team_b_name,
            ))
        await db.commit()


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
        await mark_started(sid)
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

        # Before kickoff the signup limit cannot exceed 50 players.
        r = await ac.post(
            f"/meetups/{sid}/teams/reshape",
            json={"team_count": 5, "team_size": 15},
            headers=hdr("admint"),
        )
        assert r.status_code == 400

        async with AsyncSession(engine) as db:
            meetup = await db.get(Meetup, sid)
            meetup.min_players = 10
            await db.commit()
        r = await ac.post(
            f"/meetups/{sid}/teams/reshape",
            json={"team_count": 2, "team_size": 2},
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


@pytest.mark.asyncio
async def test_capacity_updates_waitlist_and_preserves_shape_after_join():
    async with await client() as ac:
        sid = await make_meetup_with_pending_match(ac)
        async with AsyncSession(engine) as db:
            await create_test_user(db, "Late", "user-uuid")

        async def reshape(count: int, size: int) -> dict:
            response = await ac.post(
                f"/meetups/{sid}/teams/reshape",
                json={"team_count": count, "team_size": size},
                headers=hdr("admint"),
            )
            assert response.status_code == 200, response.text
            return response.json()

        await reshape(2, 4)
        detail = (await ac.get(f"/meetups/{sid}", headers=hdr("admint"))).json()
        statuses = {a["display_name"]: a["status"] for a in detail["attendees"]}
        assert [statuses[f"P{i}"] for i in range(1, 13)] == ["confirmed"] * 8 + ["waitlisted"] * 4
        assert detail["max_players"] == 8 and detail["has_started"] is False

        await reshape(3, 3)
        detail = (await ac.get(f"/meetups/{sid}", headers=hdr("admint"))).json()
        statuses = {a["display_name"]: a["status"] for a in detail["attendees"]}
        assert [statuses[f"P{i}"] for i in range(1, 13)] == ["confirmed"] * 9 + ["waitlisted"] * 3

        await reshape(3, 4)
        detail = (await ac.get(f"/meetups/{sid}", headers=hdr("admint"))).json()
        assert all(a["status"] == "confirmed" for a in detail["attendees"])

        shaped = await reshape(4, 5)
        assert sorted(len(t["players"]) for t in shaped["teams"]) == [3, 3, 3, 3]
        detail = (await ac.get(f"/meetups/{sid}", headers=hdr("admint"))).json()
        assert (detail["max_teams"], detail["team_size"], detail["max_players"]) == (4, 5, 20)
        joined = await ac.post(f"/meetups/{sid}/join", headers=hdr("user"))
        assert joined.json()["status"] == "confirmed"
        updated = (await ac.get(f"/meetups/{sid}/teams", headers=hdr("admint"))).json()["teams"]
        assert sorted(len(t["players"]) for t in updated) == [3, 3, 3, 4]
        original_ids = {p["id"] for team in shaped["teams"] for p in team["players"]}
        updated_ids = {p["id"] for team in updated for p in team["players"]}
        assert original_ids < updated_ids and len(updated_ids) == 13
        again = (await ac.get(f"/meetups/{sid}/teams", headers=hdr("admint"))).json()["teams"]
        assert updated == again


@pytest.mark.asyncio
async def test_auto_balanced_redrafts_when_players_join_after_shape():
    async with await client() as ac:
        async with AsyncSession(engine) as db:
            db.add(User(pocket_id_sub="admint-uuid", is_admin=True))
            db.add(RatingSettings(id=1, computed_scores=False))
            db.add_all(
                User(pocket_id_sub=f"p{i}-uuid", seed_skill=skill, calculated_skill=skill)
                for i, skill in enumerate((2.5, 1.5, 1.5, 1.5, 1, 1, 3), 1)
            )
            await db.commit()

        created = await ac.post(
            "/meetups/",
            json={"start_time": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
                  "location": "Pitch", "min_players": 1, "max_players": 8,
                  "send_push_notifications": False},
            headers=hdr("admint"),
        )
        assert created.status_code == 201
        sid = created.json()["id"]
        assert created.json()["team_assignment_mode"] == "auto-balanced"
        for n in range(1, 6):
            response = await ac.post(f"/meetups/{sid}/join", headers=hdr(f"p{n}"))
            assert response.status_code == 200
        shaped = await ac.post(
            f"/meetups/{sid}/teams/reshape", json={"team_count": 2, "team_size": 4},
            headers=hdr("admint"),
        )
        assert shaped.status_code == 200, shaped.text
        async with AsyncSession(engine) as db:
            meetup = await db.get(Meetup, sid)
            assert meetup.manual_teams_json is None
        response = await ac.post(f"/meetups/{sid}/join", headers=hdr("p6"))
        assert response.status_code == 200 and response.json()["status"] == "confirmed"
        teams = (await ac.get(f"/meetups/{sid}/teams", headers=hdr("admint"))).json()["teams"]
        assert [sum(p["skillScore"] for p in team["players"]) for team in teams] == [4.5, 4.5]
        repeated = (await ac.get(f"/meetups/{sid}/teams", headers=hdr("admint"))).json()["teams"]
        assert repeated == teams

        # A prepared match is still adjustable until its timer starts.
        started = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        assert started.status_code == 201, started.text
        response = await ac.post(f"/meetups/{sid}/join", headers=hdr("p7"))
        assert response.status_code == 200
        updated = (await ac.get(f"/meetups/{sid}/teams", headers=hdr("admint"))).json()["teams"]
        assert sorted(len(team["players"]) for team in updated) == [3, 4]
        assert any(
            {p["id"] for p in old["players"]} - {p["id"] for p in new["players"]}
            for old, new in zip(teams, updated, strict=True)
        )
        async with AsyncSession(engine) as db:
            pending = await db.scalar(select(MeetupMatch).where(MeetupMatch.meetup_id == sid))
            assert set(json.loads(pending.team_a_users)) == {int(p["id"]) for p in updated[0]["players"]}
            assert set(json.loads(pending.team_b_users)) == {int(p["id"]) for p in updated[1]["players"]}


@pytest.mark.asyncio
async def test_started_match_keeps_confirmed_players_and_history():
    async with await client() as ac:
        sid = await make_meetup_with_pending_match(ac)
        await mark_started(sid)
        async with AsyncSession(engine) as db:
            meetup = await db.get(Meetup, sid)
            meetup.min_players = 10
            matches = (await db.execute(
                select(MeetupMatch).where(MeetupMatch.meetup_id == sid)
            )).scalars().all()
            snapshots = {m.id: (m.team_a_users, m.team_b_users, m.team_a_name, m.team_b_name)
                         for m in matches if m.status != "pending"}
            await db.commit()

        response = await ac.post(
            f"/meetups/{sid}/teams/reshape",
            json={"team_count": 2, "team_size": 2},
            headers=hdr("admint"),
        )
        assert response.status_code == 200, response.text
        assert [len(t["players"]) for t in response.json()["teams"]] == [2, 2, 8]
        detail = (await ac.get(f"/meetups/{sid}", headers=hdr("admint"))).json()
        assert detail["has_started"] is True
        assert (detail["team_size"], detail["max_players"]) == (2, 10)
        assert sum(a["status"] == "confirmed" for a in detail["attendees"]) == 12
        async with AsyncSession(engine) as db:
            for match_id, snapshot in snapshots.items():
                m = await db.get(MeetupMatch, match_id)
                assert (m.team_a_users, m.team_b_users, m.team_a_name, m.team_b_name) == snapshot


@pytest.mark.asyncio
async def test_capacity_can_be_set_without_registered_players():
    async with await client() as ac:
        sid = await make_meetup_with_pending_match(ac)
        async with AsyncSession(engine) as db:
            rows = (await db.execute(select(Attendance).where(Attendance.meetup_id == sid))).scalars().all()
            for row in rows:
                row.status = "cancelled"
            await db.commit()
        response = await ac.post(
            f"/meetups/{sid}/teams/reshape",
            json={"team_count": 4, "team_size": 5},
            headers=hdr("admint"),
        )
        assert response.status_code == 200, response.text
        assert response.json()["teams"] == []
        detail = (await ac.get(f"/meetups/{sid}", headers=hdr("admint"))).json()
        assert (detail["max_players"], detail["team_size"]) == (20, 5)
        pm = await pending_match(ac, sid)
        timer = f"/meetups/{sid}/matches/{pm['id']}/timer/start"
        blocked = await ac.post(timer, headers=hdr("admint"))
        assert blocked.status_code == 409
        assert "Both teams need a player" in blocked.json()["detail"]

        for token in ("p1", "p2"):
            assert (await ac.post(f"/meetups/{sid}/join", headers=hdr(token))).json()["status"] == "confirmed"
        pm = await pending_match(ac, sid)
        assert len(pm["team_a"]["users"]) == len(pm["team_b"]["users"]) == 1
        assert (await ac.post(timer, headers=hdr("admint"))).status_code == 200
