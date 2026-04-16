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
async def test_rating_constraint_unattended_session():
    async with async_session() as db:
        auth_user = User(username="tester", email="test@test.com")
        db.add(auth_user)
        await db.commit()
        await db.refresh(auth_user)

        session = GameSession(
            start_time=datetime.utcnow(), location="Test Park", max_players=10
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)

        session_id = session.id
        ratee_id = auth_user.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/ratings/",
            headers={settings.AUTHELIA_USER_HEADER: "tester"},
            json={
                "session_id": session_id,
                "ratee_id": ratee_id,
                "score": 5,
            },
        )
    assert resp.status_code == 403
    assert (
        resp.json()["detail"]
        == "You can only rate players from sessions you attended"
    )


@pytest.mark.asyncio
async def test_anonymity_check():
    async with async_session() as db:
        auth_user = User(username="tester", email="test@test.com")
        player = User(username="player1", email="player1@test.com")
        db.add_all([auth_user, player])
        await db.commit()
        await db.refresh(auth_user)
        await db.refresh(player)

        session = GameSession(
            start_time=datetime.utcnow(), location="Test Park", max_players=10
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)

        sid = session.id
        pid = player.id
        db.add(Attendance(session_id=sid, user_id=auth_user.id))
        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post(
            "/ratings/",
            headers={settings.AUTHELIA_USER_HEADER: "tester"},
            json={
                "session_id": sid,
                "ratee_id": pid,
                "score": 5,
            },
        )

        resp = await ac.get(
            f"/ratings/players/{pid}",
            headers={settings.AUTHELIA_USER_HEADER: "tester"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "average_score" in data
    assert "total_ratings" in data
    assert "rater_id" not in data
    assert "username" not in data


@pytest.mark.asyncio
async def test_score_update_verification():
    async with async_session() as db:
        auth_user = User(username="tester", email="test@test.com")
        player1 = User(username="p1", email="p1@test.com")
        db.add_all([auth_user, player1])
        await db.commit()
        await db.refresh(auth_user)
        await db.refresh(player1)

        session = GameSession(
            start_time=datetime.utcnow(), location="Test Park", max_players=10
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)

        for uid in (auth_user.id, player1.id):
            db.add(Attendance(session_id=session.id, user_id=uid))
        await db.commit()

        session2 = GameSession(
            start_time=datetime.utcnow(), location="Test Park 2", max_players=10
        )
        db.add(session2)
        await db.commit()
        await db.refresh(session2)
        db.add(Attendance(session_id=session2.id, user_id=auth_user.id))
        await db.commit()

        sid1 = session.id
        sid2 = session2.id
        p1id = player1.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post(
            "/ratings/",
            headers={settings.AUTHELIA_USER_HEADER: "tester"},
            json={
                "session_id": sid1,
                "ratee_id": p1id,
                "score": 5,
            },
        )
        await ac.post(
            "/ratings/",
            headers={settings.AUTHELIA_USER_HEADER: "tester"},
            json={
                "session_id": sid2,
                "ratee_id": p1id,
                "score": 3,
            },
        )

        resp = await ac.get(
            f"/ratings/players/{p1id}",
            headers={settings.AUTHELIA_USER_HEADER: "tester"},
        )
    assert resp.status_code == 200
    assert resp.json()["average_score"] == 4.0
