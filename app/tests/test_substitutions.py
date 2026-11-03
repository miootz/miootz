"""Pre-start substitutions: swap records history, updates the match rosters,
and persists the partition to manual_teams_json (future rounds inherit it)."""

import json

from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.core.timeutil import utcnow
from app.models.match import MatchSubstitution, MeetupMatch
from app.models.match_editor_lease import MatchEditorLease
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


async def seed(ac: AsyncClient, tokens: list[str]) -> None:
    async with AsyncSession(engine) as db:
        await create_test_user(db, "Admint", "admint-uuid", is_admin=True)
        for n in tokens:
            await create_test_user(db, n.upper(), f"{n}-uuid")


async def make_meetup_with_pending_match(
    ac: AsyncClient, tokens: list[str]
) -> tuple[int, dict]:
    """Meetup + joins + started (pending) match. Returns (meetup_id, response)."""
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

    for t in tokens:
        rj = await ac.post(f"/meetups/{sid}/join", headers=hdr(t))
        assert rj.status_code == 200, rj.text

    rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
    assert rs.status_code == 201, rs.text
    return sid, rs.json()


def roster_ids(match: dict) -> tuple[list[int], list[int]]:
    return (
        [u["id"] for u in match["team_a"]["users"]],
        [u["id"] for u in match["team_b"]["users"]],
    )


async def user_id_by_sub(pocket_id_sub: str) -> int:
    async with AsyncSession(engine) as db:
        res = await db.execute(
            select(User).where(User.pocket_id_sub == pocket_id_sub)
        )
        return res.scalar_one().id


async def hold_lease(match_id: int, user_id: int) -> None:
    """Direct DB lease setup — the acquire API is covered by live-scoring tests."""
    async with AsyncSession(engine) as db:
        now = utcnow()
        lease = await db.get(MatchEditorLease, match_id)
        if lease is None:
            lease = MatchEditorLease(match_id=match_id)
            db.add(lease)
        lease.holder_id = user_id
        lease.acquired_at = now
        lease.expires_at = now + timedelta(seconds=45)
        lease.release_token = "test-token"
        await db.commit()


@pytest.mark.asyncio
async def test_swap_pending_records_history_and_updates_match():
    async with await client() as ac:
        tokens = ["p1", "p2", "p3", "tp1"]
        await seed(ac, tokens)
        sid, started = await make_meetup_with_pending_match(ac, tokens)
        mid = started["match"]["id"]
        a_ids, b_ids = roster_ids(started["match"])
        a1, a2 = a_ids
        b1, b2 = b_ids
        await hold_lease(mid, await user_id_by_sub("admint-uuid"))

        # 1-for-1 swap: a1 (team A) <-> b1 (team B)
        r = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json={"team_a_users": [a2, b1], "team_b_users": [b2, a1]},
            headers=hdr("admint"),
        )
        assert r.status_code == 200, r.text
        assert roster_ids(r.json()) == ([a2, b1], [b2, a1])

        h = (
            await ac.get(
                f"/meetups/{sid}/matches/{mid}/substitutions", headers=hdr("admint")
            )
        ).json()
        assert len(h["substitutions"]) == 1
        row = h["substitutions"][0]
        assert set(row["old_team_a_users"]) == {a1, a2}
        assert set(row["old_team_b_users"]) == {b1, b2}
        assert set(row["new_team_b_users"]) == {b2, a1}
        assert row["recorded_by"] == "Admint"

        # manual_teams_json captured the swapped partition
        async with AsyncSession(engine) as db:
            m = await db.get(Meetup, sid)
            partition = {frozenset(t) for t in json.loads(m.manual_teams_json)}
        assert partition == {frozenset({a2, b1}), frozenset({b2, a1})}

        # Second swap on the same pending match: b1 (now A) <-> b2 (B)
        r2 = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json={"team_a_users": [a2, b2], "team_b_users": [b1, a1]},
            headers=hdr("admint"),
        )
        assert r2.status_code == 200, r2.text
        h2 = (
            await ac.get(
                f"/meetups/{sid}/matches/{mid}/substitutions", headers=hdr("admint")
            )
        ).json()
        rows = h2["substitutions"]
        assert len(rows) == 2
        # Chain: row 2's "before" is row 1's "after", oldest first.
        assert rows[0]["id"] < rows[1]["id"]
        assert set(rows[1]["old_team_a_users"]) == set(rows[0]["new_team_a_users"])
        assert set(rows[1]["old_team_b_users"]) == set(rows[0]["new_team_b_users"])
        assert set(rows[1]["new_team_a_users"]) == {a2, b2}


@pytest.mark.asyncio
async def test_swap_three_teams_only_touches_affected_teams():
    async with await client() as ac:
        async with AsyncSession(engine) as db:
            await create_test_user(db, "Admint", "admint-uuid", is_admin=True)
            user_ids: list[int] = []
            for i in range(1, 12):
                u = await create_test_user(db, f"U{i}", f"sub3-{i}-uuid")
                user_ids.append(u.id)

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
        sid = r.json()["id"]
        # 11 confirmed players -> 3 teams; attendance inserted directly
        async with AsyncSession(engine) as db:
            for uid in user_ids:
                db.add(Attendance(meetup_id=sid, user_id=uid, status="confirmed"))
            await db.commit()

        before = (
            await ac.get(f"/meetups/{sid}/teams", headers=hdr("admint"))
        ).json()
        teams_before = [
            frozenset(str(p["id"]) for p in t["players"]) for t in before["teams"]
        ]
        assert len(teams_before) == 3

        rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        assert rs.status_code == 201, rs.text
        m = rs.json()["match"]
        mid = m["id"]
        a_ids, b_ids = roster_ids(m)
        a_ids_s = [str(i) for i in a_ids]
        b_ids_s = [str(i) for i in b_ids]

        # 1-for-1 swap: a_ids[0] <-> b_ids[0]; team sizes stay equal
        await hold_lease(mid, await user_id_by_sub("admint-uuid"))
        r = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json={
                "team_a_users": [b_ids[0]] + a_ids[1:],
                "team_b_users": [a_ids[0]] + b_ids[1:],
            },
            headers=hdr("admint"),
        )
        assert r.status_code == 200, r.text

        after = (
            await ac.get(f"/meetups/{sid}/teams", headers=hdr("admint"))
        ).json()
        teams_after = [
            frozenset(str(p["id"]) for p in t["players"]) for t in after["teams"]
        ]
        # Only the two match teams changed; the third team is untouched.
        untouched = [
            t for t in teams_before
            if t not in (frozenset(a_ids_s), frozenset(b_ids_s))
        ]
        assert len(untouched) == 1
        new_a_s = [str(b_ids[0])] + a_ids_s[1:]
        new_b_s = [str(a_ids[0])] + b_ids_s[1:]
        assert untouched == [
            t for t in teams_after
            if t not in (frozenset(new_a_s), frozenset(new_b_s))
        ]


@pytest.mark.asyncio
async def test_swap_from_non_playing_team_updates_bench():
    """A bench player enters the match 1-for-1; the bench team loses them."""
    async with await client() as ac:
        async with AsyncSession(engine) as db:
            await create_test_user(db, "Admint", "admint-uuid", is_admin=True)
            user_ids: list[int] = []
            for i in range(1, 12):
                u = await create_test_user(db, f"U{i}", f"sub3b-{i}-uuid")
                user_ids.append(u.id)

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
        sid = r.json()["id"]
        async with AsyncSession(engine) as db:
            for uid in user_ids:
                db.add(Attendance(meetup_id=sid, user_id=uid, status="confirmed"))
            await db.commit()

        rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        assert rs.status_code == 201, rs.text
        m = rs.json()["match"]
        mid = m["id"]
        a_ids, b_ids = roster_ids(m)
        in_match = set(a_ids) | set(b_ids)
        bench = [u for u in user_ids if u not in in_match]
        assert bench, "expected a non-playing team"

        # Bench player b0 swaps INTO team A for a1 (sizes preserved).
        await hold_lease(mid, await user_id_by_sub("admint-uuid"))
        r = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json={
                "team_a_users": [bench[0]] + a_ids[1:],
                "team_b_users": b_ids,
            },
            headers=hdr("admint"),
        )
        assert r.status_code == 200, r.text
        new_a, new_b = roster_ids(r.json())
        assert new_a == [bench[0]] + a_ids[1:]
        assert new_b == b_ids

        # The stored partition keeps the bench player OUT of the bench team.
        async with AsyncSession(engine) as db:
            mup = await db.get(Meetup, sid)
            partition = [set(t) for t in json.loads(mup.manual_teams_json)]
        assert bench[0] in set(new_a)
        assert not any(bench[0] in t and t != set(new_a) for t in partition)
        # a_ids[0] (swapped out) returned to the bench team: the partition
        # stays a full split of all 11 confirmed players.
        assert sum(len(t) for t in partition) == 11
        assert any(a_ids[0] in t and t != set(new_a) for t in partition)

        # Duplicates are rejected.
        r2 = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json={
                "team_a_users": [bench[0], bench[0]],  # same player twice
                "team_b_users": b_ids,
            },
            headers=hdr("admint"),
        )
        assert r2.status_code == 400, r2.text


@pytest.mark.asyncio
async def test_swap_out_returns_to_source_bench_team():
    """4 teams / 2 pitches: a swapped-out player takes the incoming player's
    former spot on the source bench team, not the first bench team."""
    async with await client() as ac:
        async with AsyncSession(engine) as db:
            await create_test_user(db, "Admint", "admint-uuid", is_admin=True)
            user_ids: list[int] = []
            for i in range(1, 17):
                u = await create_test_user(db, f"U{i}", f"sub4-{i}-uuid")
                user_ids.append(u.id)

        start = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=5)
        r = await ac.post(
            "/meetups/",
            json={
                "start_time": start.isoformat(),
                "location": "Two pitches",
                "min_players": 1,
                "max_players": 40,
                "max_teams": 4,
                "send_push_notifications": False,
            },
            headers=hdr("admint"),
        )
        sid = r.json()["id"]
        # Four known teams (4/4/4/4): first two play, last two are the bench.
        # manual_teams_json pins every resolver (start, /teams, swap) to the
        # same partition — start_matches ignores max_teams.
        partition = [user_ids[0:4], user_ids[4:8], user_ids[8:12], user_ids[12:16]]
        async with AsyncSession(engine) as db:
            for uid in user_ids:
                db.add(Attendance(meetup_id=sid, user_id=uid, status="confirmed"))
            mup = await db.get(Meetup, sid)
            mup.manual_teams_json = json.dumps(partition)
            await db.commit()

        rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admint"))
        assert rs.status_code == 201, rs.text
        m = rs.json()["match"]
        mid = m["id"]
        a_ids, b_ids = roster_ids(m)
        assert sorted(int(u) for u in a_ids) == sorted(partition[0])
        assert sorted(int(u) for u in b_ids) == sorted(partition[1])

        src = set(partition[3])      # 2nd bench team
        other = set(partition[2])    # 1st bench team
        src_player = min(src)
        released = a_ids[0]

        # src_player (2nd bench team) swaps INTO team A for a_ids[0].
        await hold_lease(mid, await user_id_by_sub("admint-uuid"))
        r = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json={
                "team_a_users": [src_player] + a_ids[1:],
                "team_b_users": b_ids,
            },
            headers=hdr("admint"),
        )
        assert r.status_code == 200, r.text

        async with AsyncSession(engine) as db:
            mup = await db.get(Meetup, sid)
            partition = [set(t) for t in json.loads(mup.manual_teams_json)]
        assert sum(len(t) for t in partition) == 16
        # The released player joined the SOURCE bench team, not the first one.
        src_home = next(t for t in partition if (src - {src_player}) & t)
        assert released in src_home
        other_home = next(t for t in partition if (other - {released}) & t)
        assert released not in other_home


@pytest.mark.asyncio
async def test_swap_rejects_player_set_change():
    async with await client() as ac:
        tokens = ["p1", "p2", "p3", "tp1"]
        await seed(ac, tokens)
        sid, started = await make_meetup_with_pending_match(ac, tokens)
        mid = started["match"]["id"]
        a_ids, b_ids = roster_ids(started["match"])
        a1, a2 = a_ids
        b1, b2 = b_ids

        # Put b1 on both teams / drop b2 — not a re-arrangement
        r = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json={"team_a_users": [a1, a2, b1], "team_b_users": [b1]},
            headers=hdr("admint"),
        )
        assert r.status_code == 400, r.text

        r2 = await ac.get(
            f"/meetups/{sid}/matches/{mid}/substitutions", headers=hdr("admint")
        )
        assert r2.json()["substitutions"] == []


@pytest.mark.asyncio
async def test_swap_completed_match_409_and_non_admin_403():
    async with await client() as ac:
        tokens = ["p1", "p2", "p3", "tp1"]
        await seed(ac, tokens)
        sid, started = await make_meetup_with_pending_match(ac, tokens)
        mid = started["match"]["id"]
        a_ids, b_ids = roster_ids(started["match"])
        a1, a2 = a_ids
        b1, b2 = b_ids
        swap = {"team_a_users": [a2, b1], "team_b_users": [b2, a1]}

        r = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json=swap,
            headers=hdr("p1"),
        )
        assert r.status_code == 403, r.text

        # No lease held — 409 naming the holder (never silent)
        r0 = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json=swap,
            headers=hdr("admint"),
        )
        assert r0.status_code == 409, r0.text
        assert "holder_name" in r0.json()

        # Lease held by someone else — still 409, named
        await hold_lease(mid, await user_id_by_sub("p1-uuid"))
        r1 = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json=swap,
            headers=hdr("admint"),
        )
        assert r1.status_code == 409, r1.text

        async with AsyncSession(engine) as db:
            res = await db.execute(
                select(MatchSubstitution).where(MatchSubstitution.match_id == mid)
            )
            assert res.scalars().all() == []

        await hold_lease(mid, await user_id_by_sub("admint-uuid"))
        ok = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json=swap,
            headers=hdr("admint"),
        )
        assert ok.status_code == 200, ok.text

        async with AsyncSession(engine) as db:
            m = await db.get(MeetupMatch, mid)
            m.status = "completed"
            await db.commit()

        r2 = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json=swap,
            headers=hdr("admint"),
        )
        assert r2.status_code == 409, r2.text


@pytest.mark.asyncio
async def test_parallel_matches_each_have_independent_leases():
    """4 teams / 2 pitches: at the break two matches are pending at once.
    Each carries its own lease, so both pitches can substitute in parallel."""
    async with await client() as ac:
        async with AsyncSession(engine) as db:
            await create_test_user(db, "Admint", "admint-uuid", is_admin=True)
            user_ids: list[int] = []
            # admint (admin — swaps) + p1/p2 (present members) are real
            # token-holders. admint is also added as a present member so it can
            # hold a lease and swap.
            u = await create_test_user(db, "P1", "p1-uuid")
            user_ids.append(u.id)
            u = await create_test_user(db, "P2", "p2-uuid")
            user_ids.append(u.id)
            u = await create_test_user(db, "ADM", "adminadm-uuid", is_admin=True)
            user_ids.append(u.id)
            for i in range(2, 15):
                uu = await create_test_user(db, f"PAR{i}", f"par{i}-uuid")
                user_ids.append(uu.id)

        start = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=5)
        r = await ac.post(
            "/meetups/",
            json={
                "start_time": start.isoformat(),
                "location": "Two pitches",
                "min_players": 1,
                "max_players": 40,
                "max_teams": 4,
                "send_push_notifications": False,
            },
            headers=hdr("admint"),
        )
        sid = r.json()["id"]
        async with AsyncSession(engine) as db:
            for uid in user_ids:
                db.add(Attendance(meetup_id=sid, user_id=uid, status="confirmed"))
            await db.commit()

        # Two PENDING matches at once (the break state on 2 pitches). The API
        # creates matches sequentially, so both are seeded directly — this test
        # is about lease scoping, not match creation.
        async with AsyncSession(engine) as db:
            now = utcnow()
            m2 = MeetupMatch(
                meetup_id=sid,
                match_number=1,
                team_a_users=json.dumps(user_ids[0:2]),
                team_b_users=json.dumps(user_ids[2:4]),
                team_a_name="T1",
                team_b_name="T2",
                score_a=0,
                score_b=0,
                status="pending",
                timer_total_seconds=600,
            )
            m3 = MeetupMatch(
                meetup_id=sid,
                match_number=2,
                team_a_users=json.dumps(user_ids[4:6]),
                team_b_users=json.dumps(user_ids[6:8]),
                team_a_name="T3",
                team_b_name="T4",
                score_a=0,
                score_b=0,
                status="pending",
                timer_total_seconds=600,
            )
            db.add_all([m2, m3])
            await db.commit()
            await db.refresh(m2)
            await db.refresh(m3)
            m2_id, m3_id = m2.id, m3.id
            a2, b2 = user_ids[0:2], user_ids[2:4]
            a3, b3 = user_ids[4:6], user_ids[6:8]

        # adminadm takes match 2's lease — scoped, not "the current match" (m3)
        ra = await ac.post(
            f"/meetups/{sid}/matches/lease/acquire?match_id={m2_id}",
            headers=hdr("adminadm"),
        )
        assert ra.status_code == 200, ra.text
        token = ra.json()["lease_token"]

        # adminadm can ALSO take match 3's lease — independent rows, no crosstalk
        rb = await ac.post(
            f"/meetups/{sid}/matches/lease/acquire?match_id={m3_id}",
            headers=hdr("adminadm"),
        )
        assert rb.status_code == 200, rb.text

        # p2 is named on the busy match, never silent
        rc = await ac.post(
            f"/meetups/{sid}/matches/lease/acquire?match_id={m2_id}",
            headers=hdr("p2"),
        )
        assert rc.status_code == 409, rc.text
        assert rc.json()["holder_name"] == "AdminAdm"

        # Swap on match 2 works under its own lease…
        rs2 = await ac.patch(
            f"/meetups/{sid}/matches/{m2_id}/teams",
            json={
                "team_a_users": [b2[0]] + a2[1:],
                "team_b_users": [a2[0]] + b2[1:],
            },
            headers=hdr("adminadm"),
        )
        assert rs2.status_code == 200, rs2.text

        # …and match 3 independently, renewing its own scoped lease.
        rr = await ac.post(
            f"/meetups/{sid}/matches/lease/renew?match_id={m3_id}",
            json={"lease_token": rb.json()["lease_token"]},
            headers=hdr("adminadm"),
        )
        assert rr.status_code == 200, rr.text
        rs3 = await ac.patch(
            f"/meetups/{sid}/matches/{m3_id}/teams",
            json={
                "team_a_users": [b3[0]] + a3[1:],
                "team_b_users": [a3[0]] + b3[1:],
            },
            headers=hdr("adminadm"),
        )
        assert rs3.status_code == 200, rs3.text

        # Release scoped to the match
        rrel = await ac.post(
            f"/meetups/{sid}/matches/lease/release?match_id={m2_id}",
            json={"lease_token": token},
            headers=hdr("adminadm"),
        )
        assert rrel.status_code == 200, rrel.text


@pytest.mark.asyncio
async def test_deleting_match_deletes_substitution_history():
    async with await client() as ac:
        tokens = ["p1", "p2", "p3", "tp1"]
        await seed(ac, tokens)
        sid, started = await make_meetup_with_pending_match(ac, tokens)
        mid = started["match"]["id"]
        a_ids, b_ids = roster_ids(started["match"])
        a1, a2 = a_ids
        b1, b2 = b_ids
        await hold_lease(mid, await user_id_by_sub("admint-uuid"))

        r = await ac.patch(
            f"/meetups/{sid}/matches/{mid}/teams",
            json={"team_a_users": [a2, b1], "team_b_users": [b2, a1]},
            headers=hdr("admint"),
        )
        assert r.status_code == 200, r.text

        rd = await ac.delete(f"/meetups/{sid}/matches/{mid}", headers=hdr("admint"))
        assert rd.status_code == 204, rd.text

        async with AsyncSession(engine) as db:
            res = await db.execute(
                select(MatchSubstitution).where(MatchSubstitution.match_id == mid)
            )
            assert res.scalars().all() == []
