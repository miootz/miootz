import pytest
from datetime import datetime, timedelta, UTC
from httpx import ASGITransport, AsyncClient

from app.api.main import app
from app.core.database import Base, async_session, engine
from app.models.meetup import Attendance, Meetup
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.mark.asyncio
async def test_skill_score_calculation_logic():
    async with async_session() as db:
        auth_user = User(
            pocket_id_sub="tester-uuid",
            sso_display_name="tester",
            self_assessed_skill=3,
        )
        player = User(
            pocket_id_sub="test-p1", sso_display_name="p1", self_assessed_skill=3
        )
        rater1 = User(pocket_id_sub="test-r1", sso_display_name="r1")
        db.add_all([auth_user, player, rater1])
        await db.commit()
        await db.refresh(auth_user)
        await db.refresh(player)
        await db.refresh(rater1)

        meetup1 = Meetup(
            start_time=datetime.now(UTC) - timedelta(hours=48),
            location="Park 1",
            max_players=10,
        )
        db.add(meetup1)
        await db.commit()
        await db.refresh(meetup1)

        s1id = meetup1.id
        for uid in (rater1.id, player.id, auth_user.id):
            db.add(Attendance(meetup_id=s1id, user_id=uid))
        await db.commit()

        player_id = player.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/ratings/",
            headers={"Authorization": "Bearer tester"},
            json={
                "meetup_id": s1id,
                "ratee_id": player_id,
                "score": 5,
            },
        )
        assert resp.status_code == 200, f"rating failed: {resp.text}"

    async with async_session() as db:
        player_row = await db.get(User, player_id)
        assert player_row is not None
        assert player_row.calculated_skill is not None, (
            f"calculated_skill was None (self_assessed={player_row.self_assessed_skill})"
        )
