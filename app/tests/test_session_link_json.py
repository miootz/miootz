"""JSON session-link action API (SPA email links)."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.main import app
from app.core.database import Base, engine


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.mark.asyncio
async def test_session_link_action_rejects_bad_token(setup_db):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/session-links/action", json={"t": "not-a-valid-token"})
    assert r.status_code == 400
