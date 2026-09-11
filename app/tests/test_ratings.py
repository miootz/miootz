import pytest
from datetime import datetime, timedelta, UTC
from httpx import ASGITransport, AsyncClient

from app.api.main import app
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
        auth_user = User(pocket_id_sub="tester-uuid", sso_display_name="tester")
        db.add(auth_user)
        await db.commit()
        await db.refresh(auth_user)

        session = GameSession(
            start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=5),
            location="Test Park",
            max_players=10,
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
            headers={"Authorization": "Bearer tester"},
            json={
                "session_id": session_id,
                "ratee_id": ratee_id,
                "score": 5,
            },
        )
    assert resp.status_code == 403
    assert (
        resp.json()["detail"] == "You can only rate players from sessions you attended"
    )


@pytest.mark.asyncio
async def test_anonymity_check():
    async with async_session() as db:
        auth_user = User(pocket_id_sub="tester-uuid", sso_display_name="tester")
        player = User(pocket_id_sub="test-player1", sso_display_name="player1")
        db.add_all([auth_user, player])
        await db.commit()
        await db.refresh(auth_user)
        await db.refresh(player)

        session = GameSession(
            start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=5),
            location="Test Park",
            max_players=10,
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
            headers={"Authorization": "Bearer tester"},
            json={
                "session_id": sid,
                "ratee_id": pid,
                "score": 5,
            },
        )

        resp = await ac.get(
            f"/ratings/players/{pid}",
            headers={"Authorization": "Bearer tester"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "average_score" in data
    assert "total_ratings" in data
    assert "rater_id" not in data
    assert "username" not in data


@pytest.mark.asyncio
async def test_score_update_verification():
    """Two ratings in different sessions; no earlier session locks the first."""
    async with async_session() as db:
        auth_user = User(pocket_id_sub="tester-uuid", sso_display_name="tester")
        player1 = User(pocket_id_sub="test-p1", sso_display_name="p1")
        db.add_all([auth_user, player1])
        await db.commit()
        await db.refresh(auth_user)
        await db.refresh(player1)

        session = GameSession(
            start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=3),
            location="Test Park",
            max_players=10,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)

        for uid in (auth_user.id, player1.id):
            db.add(Attendance(session_id=session.id, user_id=uid))
        await db.commit()

        sid1 = session.id
        p1id = player1.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            "/ratings/",
            headers={"Authorization": "Bearer tester"},
            json={
                "session_id": sid1,
                "ratee_id": p1id,
                "score": 5,
            },
        )
        assert r1.status_code == 200

        async with async_session() as db:
            session2 = GameSession(
                start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2),
                location="Test Park 2",
                max_players=10,
            )
            db.add(session2)
            await db.commit()
            await db.refresh(session2)
            db.add(Attendance(session_id=session2.id, user_id=auth_user.id))
            db.add(Attendance(session_id=session2.id, user_id=player1.id))
            await db.commit()
            sid2 = session2.id

        r2 = await ac.post(
            "/ratings/",
            headers={"Authorization": "Bearer tester"},
            json={
                "session_id": sid2,
                "ratee_id": p1id,
                "score": 3,
            },
        )
        assert r2.status_code == 200

        resp = await ac.get(
            f"/ratings/players/{p1id}",
            headers={"Authorization": "Bearer tester"},
        )
    assert resp.status_code == 200
    assert resp.json()["average_score"] == 4.0


@pytest.mark.asyncio
async def test_rating_context_allows_non_attendee_read_only():
    async with async_session() as db:
        viewer = User(pocket_id_sub="viewer-uuid", sso_display_name="viewer")
        player = User(pocket_id_sub="test-player1", sso_display_name="player1")
        db.add_all([viewer, player])
        await db.commit()
        await db.refresh(viewer)
        await db.refresh(player)

        session = GameSession(
            start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=5),
            location="Pitch A",
            max_players=10,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)

        db.add(
            Attendance(
                session_id=session.id,
                user_id=player.id,
                status="confirmed",
            )
        )
        await db.commit()
        sid = session.id
        pid = player.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get(
            f"/ratings/sessions/{sid}/context",
            headers={"Authorization": "Bearer viewer"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["viewer_attended"] is False
    assert data["ratings_editable"] is False
    assert len(data["ratees"]) == 1
    assert data["ratees"][0]["user_id"] == pid
    assert data["ratees"][0]["my_score"] is None
