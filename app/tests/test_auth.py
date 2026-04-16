import pytest
from httpx import AsyncClient, ASGITransport
from app.api.main import app
from app.core.database import async_session, engine, Base
from app.models.user import User


@pytest.fixture(scope="module")
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.mark.asyncio
async def test_user_creation(setup_db):
    async with async_session() as session:
        new_user = User(username="testuser", email="test@example.com")
        session.add(new_user)
        await session.commit()

        from sqlalchemy import select

        result = await session.execute(select(User).where(User.username == "testuser"))
        user = result.scalar_one()
        assert user.email == "test@example.com"


@pytest.mark.asyncio
async def test_health_check():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_me_unauthenticated():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.get("/me")
    assert response.status_code == 401
