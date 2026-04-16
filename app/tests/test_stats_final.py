import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.api.main import app
from app.api.users_stats import get_current_authenticated_user
from app.core.database import Base, get_db
from app.models.user import User
from app.models.session import GameSession, Attendance
from datetime import datetime, timezone

SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_stats_final.db"


@pytest.fixture(name="engine")
def engine():
    return create_async_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )


@pytest.fixture(name="async_session_factory")
def async_session_factory(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture(name="db")
async def db_session(engine, async_session_factory):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture(name="client")
async def client(db: AsyncSession):
    async def _get_test_db():
        yield db

    app.dependency_overrides[get_db] = _get_test_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture(name="auth_user")
async def auth_user(db: AsyncSession):
    user = User(
        username="tester",
        email="test@test.com",
        self_assessed_skill=3,
        calculated_skill=3,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_games_played_count_matches_confirmed_sessions(
    client: AsyncClient, auth_user: User, db: AsyncSession
):
    session1 = GameSession(start_time=datetime.now(timezone.utc), location="Park 1")
    session2 = GameSession(start_time=datetime.now(timezone.utc), location="Park 2")
    session3 = GameSession(start_time=datetime.now(timezone.utc), location="Park 3")
    db.add_all([session1, session2, session3])
    await db.commit()

    db.add(Attendance(session_id=session1.id, user_id=auth_user.id, status="confirmed"))
    db.add(Attendance(session_id=session2.id, user_id=auth_user.id, status="confirmed"))
    db.add(
        Attendance(session_id=session3.id, user_id=auth_user.id, status="waitlisted")
    )
    await db.commit()

    app.dependency_overrides[get_current_authenticated_user] = lambda: auth_user

    response = await client.get("/users/me/stats")
    assert response.status_code == 200
    assert response.json()["games_played"] == 2


@pytest.mark.asyncio
async def test_dashboard_load_zero_vs_many_games(client: AsyncClient, db: AsyncSession):
    user_many = User(username="pro", email="pro@test.com", calculated_skill=4)
    db.add(user_many)
    await db.commit()

    for i in range(10):
        s = GameSession(start_time=datetime.now(timezone.utc), location=f"Park {i}")
        db.add(s)
        await db.commit()
        db.add(Attendance(session_id=s.id, user_id=user_many.id, status="confirmed"))
    await db.commit()

    app.dependency_overrides[get_current_authenticated_user] = lambda: user_many

    response = await client.get("/users/me/stats")
    assert response.status_code == 200
    assert response.json()["games_played"] == 10
