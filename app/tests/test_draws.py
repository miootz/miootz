"""Draw rule: a level score always ends with the away team as de-facto
winner; a draw is only *recorded* (was_draw) when the template allows it."""

from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.game_template import GameTemplate
from app.models.match import MeetupMatch
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


async def make_tied_match(ac: AsyncClient, *, allows_draws: bool):
    # Future start: joins are pre-meetup; the start is shifted into the
    # presence window after joins, before match ops.
    start = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)
    r = await ac.post(
        "/meetups/",
        json={
            "start_time": (start + timedelta(minutes=0)).isoformat(),
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

    async with AsyncSession(engine) as db:
        t = GameTemplate(
            name="Draw test",
            timezone="UTC",
            weekday=0,
            hour=0,
            minute=0,
            announce_timezone="UTC",
            announce_weekday=0,
            announce_hour=9,
            announce_minute=0,
            location="Pitch",
            fee=0.0,
            min_players=1,
            max_players=4,
            allows_draws=allows_draws,
        )
        db.add(t)
        await db.commit()
        await db.refresh(t)
        mup = await db.get(Meetup, sid)
        mup.game_template_id = t.id
        await db.commit()

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
    # Three teams: match 1 is teams[0] vs teams[1]; teams[2] is the
    # entering side, so end_match has a next match to build.
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
    return sid, mid, ids


@pytest.mark.asyncio
@pytest.mark.parametrize("allows_draws", [False, True])
async def test_tie_ends_away_winning_and_records_draw_per_flag(allows_draws):
    async with await client() as ac:
        sid, mid, ids = await make_tied_match(ac, allows_draws=allows_draws)

        # 0-0, no winner_team supplied — the old picker contract is gone.
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/end",
            json={},
            headers=hdr("admin"),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["winner_team"] == "b"

        # Draw recorded only when the template allows it.
        assert body["match"]["was_draw"] is allows_draws
        async with AsyncSession(engine) as db:
            m = (
                await db.execute(select(MeetupMatch).where(MeetupMatch.id == mid))
            ).scalar_one()
            assert m.was_draw is allows_draws
            assert m.status == "completed"

        # Auto-queue is off: no next match is created at end.
        assert body.get("next_match") is None

        # The manual path creates it: the away team stays on the pitch
        # (team B) vs the entering team (teams[2]).
        rs = await ac.post(f"/meetups/{sid}/matches/new", headers=hdr("admin"))
        assert rs.status_code == 201, rs.text
        next_match = rs.json()["match"]
        assert next_match["team_a"]["name"] == body["match"]["team_b"]["name"]
        assert {u["id"] for u in next_match["team_a"]["users"]} == {ids["p2"]}
        assert {u["id"] for u in next_match["team_b"]["users"]} == {
            ids["p3"],
            ids["p4"],
            ids["p5"],
        }


@pytest.mark.asyncio
async def test_end_match_with_skip_next_match_does_not_queue_the_next_match():
    """Ending a match via the referee's override must not auto-queue the next
    match — the referee is choosing which teams play."""
    async with await client() as ac:
        sid, mid, ids = await make_tied_match(ac, allows_draws=False)

        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/end",
            json={"skip_next_match": True},
            headers=hdr("admin"),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["winner_team"] == "b"
        assert body.get("next_match") is None
        assert body.get("all_matches_complete") is not True

        # No pending match was created.
        async with AsyncSession(engine) as db:
            res = await db.execute(
                select(MeetupMatch).where(MeetupMatch.meetup_id == sid)
            )
            matches = res.scalars().all()
            assert len(matches) == 1
            assert matches[0].status == "completed"


@pytest.mark.asyncio
async def test_end_match_without_skip_still_queues_the_next_match():
    async with await client() as ac:
        sid, mid, ids = await make_tied_match(ac, allows_draws=False)

        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/end",
            json={},
            headers=hdr("admin"),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("next_match") is not None
