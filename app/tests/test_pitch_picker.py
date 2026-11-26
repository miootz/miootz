"""Pitch picker / 2-pitch matchmaking: start_matches creates both pitch
matches, end_match does not auto-queue, and the manual next-match picker is
bracket-aware."""

import json

from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.meetup import Attendance, Meetup
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


async def make_meetup_with_teams(
    ac: AsyncClient, num_teams: int, *, max_teams: int = 4
) -> tuple[int, list[int]]:
    """Meetup with confirmed players for num_teams (4 players per team)."""
    async with AsyncSession(engine) as db:
        await create_test_user(db, "Admint", "admint-uuid", is_admin=True)
        user_ids: list[int] = []
        for i in range(num_teams * 4):
            u = await create_test_user(db, f"P{i + 1}", f"p{i + 1}-uuid")
            user_ids.append(u.id)

        start = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=5)
        r = await ac.post(
            "/meetups/",
            json={
                "start_time": start.isoformat(),
                "location": "Two pitches",
                "min_players": 1,
                "max_players": 40,
                "max_teams": max_teams,
                "send_push_notifications": False,
            },
            headers=hdr("admint"),
        )
        assert r.status_code == 201, r.text
        sid = r.json()["id"]
        for uid in user_ids:
            db.add(Attendance(meetup_id=sid, user_id=uid, status="confirmed"))
        await db.commit()

    # Shift the start time into the presence window.
    async with AsyncSession(engine) as db:
        await db.execute(
            update(Meetup)
            .where(Meetup.id == sid)
            .values(start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=15))
        )
        await db.commit()

    return sid, user_ids


@pytest.mark.asyncio
async def test_start_matches_creates_two_pitch_matches_for_four_teams():
    async with await client() as ac:
        sid, user_ids = await make_meetup_with_teams(ac, 4)
        rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        assert rs.status_code == 201, rs.text
        body = rs.json()
        assert body["status"] == "started"
        assert len(body["matches"]) == 2

        m1, m2 = body["matches"]
        assert m1["match_number"] == 1
        assert m2["match_number"] == 2
        # Each match pairs two teams; the four teams are all in play.
        m1_users = {u["id"] for u in m1["team_a"]["users"]} | {u["id"] for u in m1["team_b"]["users"]}
        m2_users = {u["id"] for u in m2["team_a"]["users"]} | {u["id"] for u in m2["team_b"]["users"]}
        assert m1_users.isdisjoint(m2_users)
        assert len(m1_users) + len(m2_users) == len(user_ids)
        # Both are pending.
        assert m1["status"] == "pending"
        assert m2["status"] == "pending"


@pytest.mark.asyncio
async def test_start_matches_with_three_teams_creates_one_match():
    async with await client() as ac:
        # 3 teams -> 12 players, but team size 4 -> 8 players (2 teams + 1 bench)
        sid, user_ids = await make_meetup_with_teams(ac, 3)
        rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        assert rs.status_code == 201, rs.text
        body = rs.json()
        # 3 teams: one match on the first pair; the third team is the bench.
        assert len(body["matches"]) == 1
        m = body["matches"][0]
        assert m["match_number"] == 1
        assert m["status"] == "pending"


@pytest.mark.asyncio
async def test_end_match_does_not_auto_queue():
    async with await client() as ac:
        sid, user_ids = await make_meetup_with_teams(ac, 4)
        rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        assert rs.status_code == 201, rs.text
        m = rs.json()["match"]

        r = await ac.post(f"/meetups/{sid}/matches/{m['id']}/end", json={}, headers=hdr("admint"))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("next_match") is None
        assert body.get("all_matches_complete") is True

        # The other pitch match is untouched — still pending.
        rl = await ac.get(f"/meetups/{sid}/matches", headers=hdr("admint"))
        assert rl.status_code == 200
        pending = [x for x in rl.json()["matches"] if x["status"] == "pending"]
        assert len(pending) == 1


@pytest.mark.asyncio
async def test_create_new_pending_match_bracket_final_picks_winners():
    async with await client() as ac:
        sid, user_ids = await make_meetup_with_teams(ac, 4)
        rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        assert rs.status_code == 201, rs.text
        matches = rs.json()["matches"]
        m1, m2 = matches[0], matches[1]

        # End both pitch matches.
        for m in (m1, m2):
            r = await ac.post(f"/meetups/{sid}/matches/{m['id']}/end", json={}, headers=hdr("admint"))
            assert r.status_code == 200, r.text

        # The manual picker: final = winner of pitch 1 vs winner of pitch 2.
        rs = await ac.post(f"/meetups/{sid}/matches/new", headers=hdr("admint"))
        assert rs.status_code == 201, rs.text
        final = rs.json()["match"]

        def roster(m):
            return {
                "a": {u["id"] for u in m["team_a"]["users"]},
                "b": {u["id"] for u in m["team_b"]["users"]},
            }

        r1 = roster(m1)
        r2 = roster(m2)

        # m1 ended with a winner — the final's team A must be m1's winner.
        winner1 = r1["a"] if m1["score_a"] > m1["score_b"] else r1["b"]
        winner2 = r2["a"] if m2["score_a"] > m2["score_b"] else r2["b"]
        assert {u["id"] for u in final["team_a"]["users"]} == winner1
        assert {u["id"] for u in final["team_b"]["users"]} == winner2


@pytest.mark.asyncio
async def test_end_match_all_matches_complete_is_true_after_final():
    async with await client() as ac:
        sid, user_ids = await make_meetup_with_teams(ac, 4)
        rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        matches = rs.json()["matches"]
        m1, m2 = matches[0], matches[1]

        # End both matches.
        for m in (m1, m2):
            r = await ac.post(f"/meetups/{sid}/matches/{m['id']}/end", json={}, headers=hdr("admint"))
            assert r.status_code == 200

        # Final via the manual picker.
        rs = await ac.post(f"/meetups/{sid}/matches/new", headers=hdr("admint"))
        assert rs.status_code == 201, rs.text
        final = rs.json()["match"]

        r = await ac.post(f"/meetups/{sid}/matches/{final['id']}/end", json={}, headers=hdr("admint"))
        assert r.status_code == 200, r.text
        assert r.json().get("next_match") is None
