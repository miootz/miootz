import pytest
from datetime import datetime
from httpx import ASGITransport, AsyncClient

from app.api.main import app
from app.core.config import settings
from app.core.database import Base, async_session, engine
from app.models.session import Attendance, GameSession
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
            username="tester",
            email="test@test.com",
            self_assessed_skill=3,
        )
        player = User(username="p1", email="p1@test.com", self_assessed_skill=3)
        rater1 = User(username="r1", email="r1@test.com")
        db.add_all([auth_user, player, rater1])
        await db.commit()
        await db.refresh(auth_user)
        await db.refresh(player)
        await db.refresh(rater1)

        session1 = GameSession(
            start_time=datetime.utcnow(), location="Park 1", max_players=10
        )
        db.add(session1)
        await db.commit()
        await db.refresh(session1)

        s1id = session1.id
        for uid in (rater1.id, player.id, auth_user.id):
            db.add(Attendance(session_id=s1id, user_id=uid))
        await db.commit()

        player_id = player.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post(
            "/ratings/",
            headers={settings.AUTHELIA_USER_HEADER: "tester"},
            json={
                "session_id": s1id,
                "ratee_id": player_id,
                "score": 5,
            },
        )

    async with async_session() as db:
        player_row = await db.get(User, player_id)
        assert player_row is not None
        assert player_row.calculated_skill is not None
