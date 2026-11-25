"""Match creation with inherited lineups: the created match stores the
starting lineups, serializes the players, and rejects a player on both sides."""

from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
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


async def make_meetup_with_players(ac: AsyncClient, tokens: list[str]):
    start = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)
    r = await ac.post(
        "/meetups/",
        json={
            "start_time": start.isoformat(),
            "location": "Pitch",
            "min_players": 1,
            "max_players": 4,
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
        ids = {}
        for t in tokens:
            ids[t] = (
                await db.execute(select(User).where(User.pocket_id_sub == f"{t}-uuid"))
            ).scalar_one().id
    return sid, ids


@pytest.mark.asyncio
async def test_create_match_stores_lineups_and_serializes_users():
    async with await client() as ac:
        sid, ids = await make_meetup_with_players(ac, ["p1", "p2", "p3", "p4"])
        r = await ac.post(
            f"/meetups/{sid}/matches/create",
            json={
                "team_a_name": "Team A",
                "team_b_name": "Team B",
                "score_a": 0,
                "score_b": 0,
                "team_a_users": [ids["p1"], ids["p2"]],
                "team_b_users": [ids["p3"], ids["p4"]],
            },
            headers=hdr("admin"),
        )
        assert r.status_code == 201, r.text
        match = r.json()["match"]
        assert match["team_a"]["name"] == "Team A"
        assert {u["id"] for u in match["team_a"]["users"]} == {ids["p1"], ids["p2"]}
        assert {u["id"] for u in match["team_b"]["users"]} == {ids["p3"], ids["p4"]}
        # User details are resolved, not placeholders
        assert all("User " not in u["display_name"] for u in match["team_a"]["users"])


@pytest.mark.asyncio
async def test_create_match_rejects_player_on_both_sides():
    async with await client() as ac:
        sid, ids = await make_meetup_with_players(ac, ["p1", "p2"])
        r = await ac.post(
            f"/meetups/{sid}/matches/create",
            json={
                "team_a_name": "Team A",
                "team_b_name": "Team B",
                "score_a": 0,
                "score_b": 0,
                "team_a_users": [ids["p1"]],
                "team_b_users": [ids["p1"]],
            },
            headers=hdr("admin"),
        )
        assert r.status_code == 400, r.text
