"""Pitch picker / 2-pitch matchmaking: start_matches creates both pitch
matches, end_match does not auto-queue, and the manual next-match picker is
bracket-aware."""

import json
import asyncio

from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
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
        assert (m1["pitch"], m2["pitch"]) == (1, 2)
        listed = (await ac.get(f"/meetups/{sid}/matches", headers=hdr("admint"))).json()
        assert listed["two_pitch"] is True
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
        assert m["pitch"] is None
        assert m["status"] == "pending"
        listed = (await ac.get(f"/meetups/{sid}/matches", headers=hdr("admint"))).json()
        assert listed["two_pitch"] is False


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
        assert body.get("all_matches_complete") is not True

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
        assert (await ac.post(f"/meetups/{sid}/matches/{m1['id']}/penalty/skip", headers=hdr("admint"))).status_code == 200

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
        assert (await ac.post(f"/meetups/{sid}/matches/{m1['id']}/penalty/skip", headers=hdr("admint"))).status_code == 200

        # Final via the manual picker.
        rs = await ac.post(f"/meetups/{sid}/matches/new", headers=hdr("admint"))
        assert rs.status_code == 201, rs.text
        final = rs.json()["match"]

        r = await ac.post(f"/meetups/{sid}/matches/{final['id']}/end", json={}, headers=hdr("admint"))
        assert r.status_code == 200, r.text
        assert r.json().get("next_match") is None


@pytest.mark.asyncio
async def test_bench_and_empty_team_do_not_create_a_second_pitch():
    async with await client() as ac:
        sid, ids = await make_meetup_with_teams(ac, 5)
        async with AsyncSession(engine) as db:
            meetup = await db.get(Meetup, sid)
            meetup.team_size = 4
            meetup.manual_teams_json = json.dumps([ids[:4], [], ids[4:8], ids[8:12], ids[12:]])
            await db.commit()

        started = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        assert started.status_code == 201, started.text
        assert len(started.json()["matches"]) == 1
        opening = started.json()["match"]
        assert {u["id"] for u in opening["team_a"]["users"]} == set(ids[:4])
        assert {u["id"] for u in opening["team_b"]["users"]} == set(ids[4:8])
        assert not (await ac.get(f"/meetups/{sid}/matches", headers=hdr("admint"))).json()["two_pitch"]

        ended = await ac.post(f"/meetups/{sid}/matches/{opening['id']}/end", json={}, headers=hdr("admint"))
        assert ended.status_code == 200, ended.text
        assert {u["id"] for u in ended.json()["next_match"]["team_b"]["users"]} == set(ids[8:12])


@pytest.mark.asyncio
async def test_second_pitch_can_start_during_first_shootout_but_final_waits():
    async with await client() as ac:
        sid, _ = await make_meetup_with_teams(ac, 4)
        started = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        first, second = started.json()["matches"]
        ended = await ac.post(f"/meetups/{sid}/matches/{first['id']}/end", json={}, headers=hdr("admint"))
        assert ended.status_code == 200 and ended.json()["penalty_due"] is True
        timer = await ac.post(f"/meetups/{sid}/matches/{second['id']}/timer/start", headers=hdr("admint"))
        assert timer.status_code == 200, timer.text
        ended = await ac.post(f"/meetups/{sid}/matches/{second['id']}/end", json={}, headers=hdr("admint"))
        assert ended.status_code == 200
        blocked = await ac.post(f"/meetups/{sid}/matches/new", headers=hdr("admint"))
        assert blocked.status_code == 409
        assert "shootout" in blocked.json()["detail"]
        skipped = await ac.post(f"/meetups/{sid}/matches/{first['id']}/penalty/skip", headers=hdr("admint"))
        assert skipped.status_code == 200
        assert (await ac.post(f"/meetups/{sid}/matches/new", headers=hdr("admint"))).status_code == 201


@pytest.mark.asyncio
async def test_final_excludes_borrowed_player_from_previous_pitch():
    async with await client() as ac:
        sid, _ = await make_meetup_with_teams(ac, 4)
        started = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        first, second = started.json()["matches"]
        assert (await ac.post(f"/meetups/{sid}/matches/{second['id']}/end", json={}, headers=hdr("admint"))).status_code == 200
        url = f"/meetups/{sid}/matches/{first['id']}"
        assert (await ac.post(f"{url}/timer/start", headers=hdr("admint"))).status_code == 200
        assert (await ac.post(f"{url}/score", json={"team": "a"}, headers=hdr("admint"))).status_code == 200
        assert (await ac.post(f"{url}/timer/pause", headers=hdr("admint"))).status_code == 200
        lease = await ac.post(f"/meetups/{sid}/matches/lease/acquire?match_id={first['id']}", headers=hdr("admint"))
        assert lease.status_code == 200, lease.text
        borrowed = second["team_b"]["users"][0]["id"]
        team_a = [u["id"] for u in first["team_a"]["users"]]
        team_b = [u["id"] for u in first["team_b"]["users"]]
        changed = await ac.patch(f"{url}/teams", json={"team_a_users": [*team_a, borrowed], "team_b_users": team_b, "add_sideline_player": True}, headers=hdr("admint"))
        assert changed.status_code == 200, changed.text
        assert (await ac.post(f"{url}/end", json={}, headers=hdr("admint"))).status_code == 200
        final = await ac.post(f"/meetups/{sid}/matches/new", headers=hdr("admint"))
        assert final.status_code == 201, final.text
        a = {u["id"] for u in final.json()["match"]["team_a"]["users"]}
        b = {u["id"] for u in final.json()["match"]["team_b"]["users"]}
        assert a == set(team_a)
        assert borrowed in b and a.isdisjoint(b)


@pytest.mark.asyncio
async def test_third_place_uses_teams_outside_manually_selected_final():
    async with await client() as ac:
        sid, _ = await make_meetup_with_teams(ac, 4)
        started = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        first, second = started.json()["matches"]
        for match in (first, second):
            assert (await ac.post(f"/meetups/{sid}/matches/{match['id']}/end", json={}, headers=hdr("admint"))).status_code == 200
        assert (await ac.post(f"/meetups/{sid}/matches/{first['id']}/penalty/skip", headers=hdr("admint"))).status_code == 200
        final = await ac.post(f"/meetups/{sid}/matches/new", json={"team_a_idx": 0, "team_b_idx": 2}, headers=hdr("admint"))
        assert final.status_code == 201, final.text
        final_match = final.json()["match"]
        assert (await ac.post(f"/meetups/{sid}/matches/{final_match['id']}/end", json={}, headers=hdr("admint"))).status_code == 200
        third = await ac.post(f"/meetups/{sid}/matches/new", headers=hdr("admint"))
        assert third.status_code == 201, third.text
        opening_names = {first["team_a"]["name"], first["team_b"]["name"], second["team_a"]["name"], second["team_b"]["name"]}
        finalists = {final_match["team_a"]["name"], final_match["team_b"]["name"]}
        assert {third.json()["match"]["team_a"]["name"], third.json()["match"]["team_b"]["name"]} == opening_names - finalists


@pytest.mark.asyncio
async def test_simultaneous_start_and_new_requests_do_not_create_duplicate_matches():
    async with await client() as ac:
        sid, _ = await make_meetup_with_teams(ac, 4)
        url = f"/meetups/{sid}/matches"
        starts = await asyncio.gather(*[ac.post(f"{url}/start", headers=hdr("admint")) for _ in range(2)])
        assert [r.status_code for r in starts] == [201, 201]
        assert {r.json()["status"] for r in starts} == {"started", "already_started"}
        matches = (await ac.get(url, headers=hdr("admint"))).json()["matches"]
        assert len(matches) == 2
        for match in matches:
            assert (await ac.post(f"{url}/{match['id']}/end", json={}, headers=hdr("admint"))).status_code == 200
        assert (await ac.post(f"{url}/{matches[0]['id']}/penalty/skip", headers=hdr("admint"))).status_code == 200
        created = await asyncio.gather(*[ac.post(f"{url}/new", headers=hdr("admint")) for _ in range(2)])
        assert sorted(r.status_code for r in created) == [201, 400]
        assert len((await ac.get(url, headers=hdr("admint"))).json()["matches"]) == 3


@pytest.mark.asyncio
async def test_two_completed_single_pitch_matches_keep_rotation_without_duplicate_players():
    async with await client() as ac:
        sid, _ = await make_meetup_with_teams(ac, 3)
        started = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        first = started.json()["match"]
        ended = await ac.post(f"/meetups/{sid}/matches/{first['id']}/end", json={}, headers=hdr("admint"))
        assert ended.status_code == 200, ended.text
        second = ended.json()["next_match"]
        assert (await ac.post(f"/meetups/{sid}/matches/{first['id']}/penalty/skip", headers=hdr("admint"))).status_code == 200
        second_url = f"/meetups/{sid}/matches/{second['id']}"
        assert (await ac.post(f"{second_url}/timer/start", headers=hdr("admint"))).status_code == 200
        assert (await ac.post(f"{second_url}/score", json={"team": "a"}, headers=hdr("admint"))).status_code == 200
        ended = await ac.post(f"{second_url}/end", json={}, headers=hdr("admint"))
        assert ended.status_code == 200
        assert ended.json().get("next_match") is None
        third = await ac.post(f"/meetups/{sid}/matches/new", headers=hdr("admint"))
        assert third.status_code == 201, third.text
        next_match = third.json()["match"]
        a = {u["id"] for u in next_match["team_a"]["users"]}
        b = {u["id"] for u in next_match["team_b"]["users"]}
        assert a == {u["id"] for u in second["team_a"]["users"]}
        assert b and a.isdisjoint(b)
        assert (await ac.get(f"/meetups/{sid}/matches", headers=hdr("admint"))).json()["two_pitch"] is False


@pytest.mark.asyncio
async def test_pitch_marker_migration_preserves_existing_meetup_and_defaults_to_single_pitch():
    from app.core.migrations import run_sqlite_migrations

    async with AsyncSession(engine) as db:
        db.add(Meetup(start_time=datetime.now(UTC).replace(tzinfo=None), location="Existing pitch"))
        await db.commit()
    async with engine.begin() as conn:
        await conn.exec_driver_sql("ALTER TABLE meetups DROP COLUMN two_pitch")
        await conn.exec_driver_sql("ALTER TABLE meetup_matches DROP COLUMN pitch")
        await run_sqlite_migrations(conn)
        await run_sqlite_migrations(conn)
        meetup = (await conn.exec_driver_sql("SELECT location, two_pitch FROM meetups")).one()
        columns = (await conn.exec_driver_sql("PRAGMA table_info(meetup_matches)")).all()
        assert tuple(meetup) == ("Existing pitch", 0)
        assert "pitch" in [column[1] for column in columns]


@pytest.mark.asyncio
async def test_prestart_swap_cannot_put_a_player_on_both_pitches():
    async with await client() as ac:
        sid, _ = await make_meetup_with_teams(ac, 4)
        started = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        first, second = started.json()["matches"]
        lease = await ac.post(f"/meetups/{sid}/matches/lease/acquire?match_id={first['id']}", headers=hdr("admint"))
        assert lease.status_code == 200, lease.text
        team_a = [u["id"] for u in first["team_a"]["users"]]
        team_b = [u["id"] for u in first["team_b"]["users"]]
        team_a[0] = second["team_a"]["users"][0]["id"]
        changed = await ac.patch(
            f"/meetups/{sid}/matches/{first['id']}/teams",
            json={"team_a_users": team_a, "team_b_users": team_b},
            headers=hdr("admint"),
        )
        assert changed.status_code == 409
        assert "another match" in changed.json()["detail"]
