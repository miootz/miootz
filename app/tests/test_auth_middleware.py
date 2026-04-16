import pytest
from httpx import ASGITransport, AsyncClient

from app.api.main import app
from app.core import config
from app.core.database import async_session, engine, Base
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_user():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as session:
        session.add(User(username="u1", email="u1@test.com"))
        await session.commit()
    yield


@pytest.mark.asyncio
async def test_remote_user_ignored_without_forwarded_when_strict(setup_user):
    old = config.settings.AUTH_REQUIRE_FORWARDED_HEADERS
    config.settings.AUTH_REQUIRE_FORWARDED_HEADERS = True
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            r = await ac.get("/me", headers={"Remote-User": "u1"})
        assert r.status_code == 401
    finally:
        config.settings.AUTH_REQUIRE_FORWARDED_HEADERS = old


@pytest.mark.asyncio
async def test_remote_user_resolves_with_forwarded_headers_when_strict(setup_user):
    old = config.settings.AUTH_REQUIRE_FORWARDED_HEADERS
    config.settings.AUTH_REQUIRE_FORWARDED_HEADERS = True
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            r = await ac.get(
                "/me",
                headers={
                    "Remote-User": "u1",
                    "X-Forwarded-For": "203.0.113.1",
                },
            )
        assert r.status_code == 200
        body = r.json()
        assert body.get("is_admin") is False
        assert body["user"]["username"] == "u1"
    finally:
        config.settings.AUTH_REQUIRE_FORWARDED_HEADERS = old
