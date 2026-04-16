import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.main import app
from app.core.database import Base, engine
from app.models.user import User
from app.models.session import GameSession, Attendance
from datetime import datetime, timedelta
from app.core.config import settings


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


async def create_test_user(
    db: AsyncSession, username: str, email: str, is_admin: bool = False
):
    user = User(username=username, email=email, is_admin=is_admin)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_session_lifecycle():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Setup Users
        async with AsyncSession(engine) as db:
            await create_test_user(db, "admin", "admin@test.com", is_admin=True)
            await create_test_user(db, "p1", "p1@test.com")
            await create_test_user(db, "p2", "p2@test.com")
            await create_test_user(db, "p3", "p3@test.com")

        # 2. Create Session (admin only)
        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": (datetime.utcnow() + timedelta(days=1)).isoformat(),
                "location": "Test Pitch",
                "min_players": 1,
                "max_players": 2,
            },
            headers={settings.AUTHELIA_USER_HEADER: "admin"},
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]

        # 3. Join Session (P1) - Confirmed
        resp = await ac.post(
            f"/sessions/{session_id}/join",
            headers={settings.AUTHELIA_USER_HEADER: "p1"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"

        # 4. Join Session (P2) - Confirmed
        resp = await ac.post(
            f"/sessions/{session_id}/join",
            headers={settings.AUTHELIA_USER_HEADER: "p2"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"

        # 5. Join Session (P3) - Waitlisted (Capacity 2)
        resp = await ac.post(
            f"/sessions/{session_id}/join",
            headers={settings.AUTHELIA_USER_HEADER: "p3"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "waitlisted"

        # 6. P1 Leaves - P3 should be promoted
        resp = await ac.delete(
            f"/sessions/{session_id}/leave",
            headers={settings.AUTHELIA_USER_HEADER: "p1"},
        )
        assert resp.status_code == 200

        # Verify P3 is now confirmed
        async with AsyncSession(engine) as db:
            from sqlalchemy import select

            res = await db.execute(select(User).where(User.username == "p3"))
            user_id = res.scalar().id
            res_att = await db.execute(
                select(Attendance).where(Attendance.user_id == user_id)
            )
            att = res_att.scalar()
            assert att.status == "confirmed"


@pytest.mark.asyncio
async def test_admin_override():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await create_test_user(db, "admin2", "admin2@test.com", is_admin=True)
            await create_test_user(db, "p1_2", "p1_2@test.com")

        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": datetime.utcnow().isoformat(),
                "location": "Override Pitch",
                "min_players": 1,
                "max_players": 1,
            },
            headers={settings.AUTHELIA_USER_HEADER: "admin2"},
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]

        # P1 joins
        await ac.post(
            f"/sessions/{session_id}/join",
            headers={settings.AUTHELIA_USER_HEADER: "p1_2"},
        )

        # Admin moves P1 to waitlist
        async with AsyncSession(engine) as db:
            from sqlalchemy import select

            res = await db.execute(select(User).where(User.username == "p1_2"))
            user_id = res.scalar().id

        resp = await ac.post(
            f"/sessions/{session_id}/admin/move?user_id={user_id}&new_status=waitlisted",
            headers={settings.AUTHELIA_USER_HEADER: "admin2"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "moved"
