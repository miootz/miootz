import os
import tempfile

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.api.main import app
from app.api.users_stats import get_current_authenticated_user
from app.core.database import Base, get_db
from app.models.user import User
from app.models.meetup import Meetup, Attendance
from datetime import datetime, UTC

# Keep test artifacts out of the repo root (was ./test_stats_final.db).
_DB_PATH = os.path.join(tempfile.gettempdir(), "miootz_test_stats_final.db")
SQLALCHEMY_DATABASE_URL = f"sqlite+aiosqlite:///{_DB_PATH}"


@pytest.fixture(name="engine")
def engine():
    if os.path.exists(_DB_PATH):
        os.remove(_DB_PATH)
    eng = create_async_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )
    yield eng
    eng.sync_engine.dispose()
    if os.path.exists(_DB_PATH):
        os.remove(_DB_PATH)


@pytest.fixture(name="async_meetup_factory")
def async_meetup_factory(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture(name="db")
async def db_session(engine, async_meetup_factory):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_meetup_factory() as meetup:
        yield meetup

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
        pocket_id_sub="tester-uuid",
        sso_display_name="tester",
        self_assessed_skill=3,
        calculated_skill=3,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_games_played_count_matches_confirmed_meetups(
    client: AsyncClient, auth_user: User, db: AsyncSession
):
    meetup1 = Meetup(start_time=datetime.now(UTC), location="Park 1")
    meetup2 = Meetup(start_time=datetime.now(UTC), location="Park 2")
    meetup3 = Meetup(start_time=datetime.now(UTC), location="Park 3")
    db.add_all([meetup1, meetup2, meetup3])
    await db.commit()

    db.add(Attendance(meetup_id=meetup1.id, user_id=auth_user.id, status="confirmed"))
    db.add(Attendance(meetup_id=meetup2.id, user_id=auth_user.id, status="confirmed"))
    db.add(
        Attendance(meetup_id=meetup3.id, user_id=auth_user.id, status="waitlisted")
    )
    await db.commit()

    app.dependency_overrides[get_current_authenticated_user] = lambda: auth_user

    # Middleware is default-deny now; the mock token passes authz and the
    # endpoint dependency override supplies the user regardless.
    response = await client.get(
        "/users/me/stats", headers={"Authorization": "Bearer tester"}
    )
    assert response.status_code == 200
    assert response.json()["games_played"] == 2


@pytest.mark.asyncio
async def test_dashboard_load_zero_vs_many_games(client: AsyncClient, db: AsyncSession):
    user_many = User(
        pocket_id_sub="test-pro", sso_display_name="pro", calculated_skill=4
    )
    db.add(user_many)
    await db.commit()

    for i in range(10):
        s = Meetup(start_time=datetime.now(UTC), location=f"Park {i}")
        db.add(s)
        await db.commit()
        db.add(Attendance(meetup_id=s.id, user_id=user_many.id, status="confirmed"))
    await db.commit()

    app.dependency_overrides[get_current_authenticated_user] = lambda: user_many

    # Middleware is default-deny now; the mock token passes authz and the
    # endpoint dependency override supplies the user regardless.
    response = await client.get(
        "/users/me/stats", headers={"Authorization": "Bearer tester"}
    )
    assert response.status_code == 200
    assert response.json()["games_played"] == 10
