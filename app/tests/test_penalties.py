"""Penalty shootout for a tied first match: turn order, clinch rule, undo,
and the de-facto-winner consequences (pitch rotation + win credit)."""

from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.match import MeetupMatch
from app.models.meetup import Meetup
from app.models.user import User
from app.services import rankings_service


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


async def make_tied_first_match(ac: AsyncClient):
    """Meetup, 3 manual teams, match 1 started — 1-1 draw to end."""
    # Future start: player joins are pre-meetup, then the start time is
    # shifted into the past (inside the presence window) before match ops.
    start = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)
    r = await ac.post(
        "/meetups/",
        json={
            "start_time": start.isoformat(),
            "location": "Pitch",
            "min_players": 1,
            "max_players": 5,
            "max_teams": 3,
            "send_push_notifications": False,
        },
        headers=hdr("admin"),
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]

    for token in ("p1", "p2", "p3", "p4", "p5"):
        rj = await ac.post(f"/meetups/{sid}/join", headers=hdr(token))
        assert rj.status_code == 200, rj.text

    async with AsyncSession(engine) as db:
        ids = {
            token: (
                await db.execute(
                    select(User).where(User.pocket_id_sub == f"{token}-uuid")
                )
            ).scalar_one().id
            for token in ("p1", "p2", "p3", "p4", "p5")
        }
        await db.execute(
            update(Meetup)
            .where(Meetup.id == sid)
            .values(start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=15))
        )
        await db.commit()

    teams = [
        [str(ids["p1"])],
        [str(ids["p2"])],
        [str(ids["p3"]), str(ids["p4"]), str(ids["p5"])],
    ]
    rt = await ac.patch(
        f"/meetups/{sid}/teams", json={"teams": teams}, headers=hdr("admin")
    )
    assert rt.status_code == 200, rt.text

    rs = await ac.post(f"/meetups/{sid}/matches/start", headers=hdr("admin"))
    assert rs.status_code == 201, rs.text
    mid = rs.json()["match"]["id"]
    rs = await ac.post(
        f"/meetups/{sid}/matches/{mid}/timer/start", headers=hdr("p1")
    )
    assert rs.status_code == 200, rs.text

    # 1-1: one goal per side via score deltas.
    for team in ("a", "b"):
        rg = await ac.post(
            f"/meetups/{sid}/matches/{mid}/score",
            json={"team": team, "delta": 1},
            headers=hdr("admin"),
        )
        assert rg.status_code == 200, rg.text

    return sid, mid, ids


async def end_tied(ac, sid, mid):
    r = await ac.post(
        f"/meetups/{sid}/matches/{mid}/end", json={}, headers=hdr("admin")
    )
    assert r.status_code == 200, r.text
    return r.json()


async def shoot(ac, sid, mid, team: str, scored: bool, scorer: int):
    return await ac.post(
        f"/meetups/{sid}/matches/{mid}/penalty/shots",
        json={"team": team, "scored": scored, "scorer_id": scorer},
        headers=hdr("admin"),
    )


@pytest.mark.asyncio
async def test_tied_first_match_flags_penalty_due():
    async with await client() as ac:
        sid, mid, _ = await make_tied_first_match(ac)
        body = await end_tied(ac, sid, mid)
        assert body["penalty_due"] is True
        assert body["match"]["penalty_winner"] is None

        r = await ac.get(
            f"/meetups/{sid}/matches/{mid}/penalty", headers=hdr("p1")
        )
        assert r.status_code == 200
        assert r.json()["available"] is True
        assert r.json()["shots"] == []


@pytest.mark.asyncio
async def test_winning_match_does_not_flag_penalty():
    async with await client() as ac:
        sid, mid, _ = await make_tied_first_match(ac)
        # Break the tie in favour of team A.
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/score",
            json={"team": "a", "delta": 1},
            headers=hdr("admin"),
        )
        assert r.status_code == 200, r.text
        body = await end_tied(ac, sid, mid)
        assert body["penalty_due"] is False


@pytest.mark.asyncio
async def test_shots_enforce_turn_and_roster():
    async with await client() as ac:
        sid, mid, ids = await make_tied_first_match(ac)
        await end_tied(ac, sid, mid)

        # Team B cannot shoot first.
        r = await shoot(ac, sid, mid, "b", True, ids["p2"])
        assert r.status_code == 400, r.text
        # Scorer must be on the shooting team.
        r = await shoot(ac, sid, mid, "a", True, ids["p2"])
        assert r.status_code == 400, r.text
        # Valid first shot.
        r = await shoot(ac, sid, mid, "a", True, ids["p1"])
        assert r.status_code == 200, r.text
        assert r.json()["counts"] == {"a": 1, "b": 0}
        assert r.json()["shots"][0]["scorer"]["id"] == ids["p1"]
        # Undo removes it.
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/penalty/undo", headers=hdr("admin")
        )
        assert r.status_code == 200, r.text
        assert r.json()["shots"] == []
        assert r.json()["counts"] == {"a": 0, "b": 0}


@pytest.mark.asyncio
async def test_finish_requires_clinch_and_sets_winner():
    async with await client() as ac:
        sid, mid, ids = await make_tied_first_match(ac)
        body = await end_tied(ac, sid, mid)

        # Not decided: 2-2 after four shots.
        await shoot(ac, sid, mid, "a", True, ids["p1"])
        await shoot(ac, sid, mid, "b", True, ids["p2"])
        await shoot(ac, sid, mid, "a", True, ids["p1"])
        await shoot(ac, sid, mid, "b", True, ids["p2"])
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/penalty/finish", headers=hdr("admin")
        )
        assert r.status_code == 400, r.text

        # 5-4 after A's sixth, then B misses the sudden-death reply →
        # decided.
        r = await shoot(ac, sid, mid, "a", True, ids["p1"])
        await shoot(ac, sid, mid, "b", True, ids["p2"])
        r = await shoot(ac, sid, mid, "a", True, ids["p1"])
        await shoot(ac, sid, mid, "b", True, ids["p2"])
        r = await shoot(ac, sid, mid, "a", True, ids["p1"])
        r = await shoot(ac, sid, mid, "b", False, ids["p2"])
        assert r.status_code == 200, r.text
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/penalty/finish", headers=hdr("admin")
        )
        assert r.status_code == 200, r.text
        assert r.json()["winner"] == "a"
        assert (r.json()["match"]["penalty_score_a"], r.json()["match"]["penalty_score_b"]) == (5, 4)
        # No game template attached → no draw recorded; winner credit
        # flips to team A via penalty_winner.
        assert r.json()["match"]["was_draw"] is False
        async with AsyncSession(engine) as db:
            m = (
                await db.execute(select(MeetupMatch).where(MeetupMatch.id == mid))
            ).scalar_one()
            assert m.penalty_winner == "a"
            assert (m.penalty_score_a, m.penalty_score_b) == (5, 4)

        # The shootout winner stays on the pitch for the next match; the
        # away team that end_match kept drops to team B.
        nxt = r.json()["next_match"]
        assert {u["id"] for u in nxt["team_a"]["users"]} == {ids["p1"]}
        assert {u["id"] for u in nxt["team_b"]["users"]} == {ids["p2"]}

        # Locked in: no more shots.
        r = await shoot(ac, sid, mid, "b", True, ids["p2"])
        assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_shootout_only_for_first_completed_tied_match():
    async with await client() as ac:
        sid, mid, _ = await make_tied_first_match(ac)
        # Not ended yet.
        r = await ac.get(
            f"/meetups/{sid}/matches/{mid}/penalty", headers=hdr("p1")
        )
        assert r.status_code == 200
        assert r.json()["available"] is False
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/penalty/shots",
            json={"team": "a", "scored": True, "scorer_id": 1},
            headers=hdr("admin"),
        )
        assert r.status_code == 409, r.text


def test_aggregate_credits_shootout_winner():
    """_aggregate: penalty_winner overrides the tie-goes-to-away rule."""
    import json

    m = MeetupMatch(
        meetup_id=1,
        match_number=1,
        team_a_users=json.dumps([11]),
        team_b_users=json.dumps([22]),
        team_a_name="A",
        team_b_name="B",
        score_a=1,
        score_b=1,
        status="completed",
        was_draw=True,
        penalty_winner="a",
    )
    stats = rankings_service._aggregate({11: 1, 22: 1}, [m], [], False, [])
    assert stats[11]["wins"] == 1
    assert stats[22]["wins"] == 0
    assert stats[11]["matches"] == 1
    assert stats[22]["matches"] == 1


def test_aggregate_tie_without_shootout_still_goes_away():
    import json

    m = MeetupMatch(
        meetup_id=1,
        match_number=2,
        team_a_users=json.dumps([11]),
        team_b_users=json.dumps([22]),
        team_a_name="A",
        team_b_name="B",
        score_a=2,
        score_b=2,
        status="completed",
        was_draw=True,
    )
    stats = rankings_service._aggregate({11: 1, 22: 1}, [m], [], False, [])
    assert stats[22]["wins"] == 1
    assert stats[11]["wins"] == 0


def test_eligible_players_half_time_boundary():
    """On-pitch ≥50% of the elapsed clock counts as played (boundary in).

    Final rosters: A=[11,22], B=[33,45]. At 300s, 44 (on B) is swapped
    off for 45 (from the bench).
    """
    import json

    from app.models.match import MatchSubstitution

    m = MeetupMatch(
        meetup_id=1,
        match_number=1,
        team_a_users=json.dumps([11, 22]),
        team_b_users=json.dumps([33, 45]),
        team_a_name="A",
        team_b_name="B",
        score_a=1,
        score_b=0,
        status="completed",
        timer_total_seconds=600,
        timer_seconds_remaining=0,
    )

    def swap_at(clock_secs: int) -> MatchSubstitution:
        return MatchSubstitution(
            meetup_id=1,
            match_id=99,
            old_team_a_users=json.dumps([11, 22]),
            old_team_b_users=json.dumps([33, 44]),
            new_team_a_users=json.dumps([11, 22]),
            new_team_b_users=json.dumps([33, 45]),
            recorded_by=1,
            clock_secs=clock_secs,
        )

    # Exactly 50%: 44 is on for 300s, 45 comes on for 300s — both count.
    assert rankings_service._eligible_players(m, [swap_at(300)]) == {
        11, 22, 33, 44, 45,
    }
    # One second later: 45 is on for 299s → not counted.
    assert rankings_service._eligible_players(m, [swap_at(301)]) == {
        11, 22, 33, 44,
    }
    # No clocked subs → everyone credited (None).
    assert rankings_service._eligible_players(m, []) is None
    assert rankings_service._eligible_players(m, [swap_at(None)]) is None

@pytest.mark.asyncio
async def test_skip_shootout_clears_shots_and_unlocks_next_match():
    async with await client() as ac:
        sid, mid, ids = await make_tied_first_match(ac)
        body = await end_tied(ac, sid, mid)
        next_id = body["next_match"]["id"]
        start_url = f"/meetups/{sid}/matches/{next_id}/timer/start"
        assert (await ac.post(start_url, headers=hdr("p1"))).status_code == 409
        assert (await shoot(ac, sid, mid, "a", True, ids["p1"])).status_code == 200
        skipped = await ac.post(f"/meetups/{sid}/matches/{mid}/penalty/skip", headers=hdr("p1"))
        assert skipped.status_code == 200, skipped.text
        assert skipped.json()["shots"] == []
        assert skipped.json()["available"] is False
        assert (await shoot(ac, sid, mid, "a", True, ids["p1"])).status_code == 409
        assert (await ac.post(start_url, headers=hdr("p1"))).status_code == 200
        async with AsyncSession(engine) as db:
            match = await db.get(MeetupMatch, mid)
            assert match.penalty_skipped is True
            assert match.penalty_winner is None


@pytest.mark.asyncio
async def test_finish_preserves_manually_queued_pair():
    async with await client() as ac:
        sid, mid, ids = await make_tied_first_match(ac)
        body = await end_tied(ac, sid, mid)
        next_id = body["next_match"]["id"]
        async with AsyncSession(engine) as db:
            match = await db.get(MeetupMatch, next_id)
            match.auto_queued = False
            match.team_a_name = "Manual A"
            match.team_b_name = "Manual B"
            await db.commit()
        for _ in range(3):
            assert (await shoot(ac, sid, mid, "a", True, ids["p1"])).status_code == 200
            assert (await shoot(ac, sid, mid, "b", False, ids["p2"])).status_code == 200
        result = await ac.post(f"/meetups/{sid}/matches/{mid}/penalty/finish", headers=hdr("p1"))
        assert result.status_code == 200, result.text
        assert result.json()["next_match"]["team_a"]["name"] == "Manual A"
        assert result.json()["next_match"]["team_b"]["name"] == "Manual B"
        assert (await ac.post(f"/meetups/{sid}/matches/{next_id}/timer/start", headers=hdr("p1"))).status_code == 200


@pytest.mark.asyncio
async def test_only_admin_can_reset_or_delete_match():
    async with await client() as ac:
        sid, mid, _ = await make_tied_first_match(ac)
        reset = f"/meetups/{sid}/matches/{mid}/timer/reset"
        match = f"/meetups/{sid}/matches/{mid}"
        assert (await ac.post(reset, headers=hdr("p1"))).status_code == 403
        assert (await ac.delete(match, headers=hdr("p1"))).status_code == 403
        assert (await ac.post(reset, headers=hdr("admin"))).status_code == 200
        assert (await ac.delete(match, headers=hdr("admin"))).status_code == 204
