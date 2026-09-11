"""Rate limiting + removed magic-link surface (prod hardening, fix 4)."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.main import app
from app.api.rate_limit import LIMIT_PUBLIC
from app.core.database import Base, engine


@pytest.fixture
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def _max_per_minute() -> int:
    # LIMIT_PUBLIC is e.g. "30 per minute"
    return int(LIMIT_PUBLIC.split()[0])


@pytest.mark.asyncio
async def test_plus_one_preview_rate_limited(setup_db):
    """Anonymous plus-one preview is capped per client (no unbounded probing)."""
    n = _max_per_minute()
    codes = []
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        for _ in range(n + 5):
            r = await ac.get("/sessions/plus-one/nonexistent-claim-token")
            codes.append(r.status_code)
    # Allowed requests reach the endpoint (404 for an unknown token)…
    assert codes[:n] == [404] * n
    # …and once the window is exhausted the client is throttled.
    assert codes[n] == 429
    assert set(codes[n + 1 :]) == {429}


@pytest.mark.asyncio
async def test_rate_limit_response_is_json_429(setup_db):
    n = _max_per_minute()
    responses = []
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        for _ in range(n + 1):
            responses.append(await ac.get("/sessions/plus-one/another-token"))
    r = responses[-1]
    assert r.status_code == 429
    assert "detail" in r.json()


@pytest.mark.asyncio
async def test_old_session_link_route_denied_without_token(setup_db):
    """The public magic-link route is off the allowlist → default-deny 401."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.post("/session-links/action", json={"t": "whatever"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_old_session_link_route_removed_for_authed_users(setup_db):
    """Even a valid session finds no route — the whole surface is gone."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.post(
            "/session-links/action",
            json={"t": "whatever"},
            headers={"Authorization": "Bearer usertoken"},
        )
    assert r.status_code == 404
