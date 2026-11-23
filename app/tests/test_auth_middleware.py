"""Tests for Pocket ID JWT auth middleware."""

import asyncio
from datetime import UTC, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api import middleware
from app.api.main import app
from app.core.database import async_session, engine, Base
from app.core.timeutil import utcnow

from app.models.user import User


@pytest.fixture(scope="function")
async def setup_user():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as meetup:
        meetup.add(
            User(
                pocket_id_sub="user-uuid",
                sso_display_name="User",
                sso_groups=["members"],
            )
        )
        meetup.add(
            User(
                pocket_id_sub="admin-uuid",
                sso_display_name="Admin",
                sso_groups=["admins", "members"],
            )
        )
        await meetup.commit()
    yield


@pytest.mark.asyncio
async def test_missing_token_returns_401(setup_user):
    """Requests without a valid Bearer token should get 401 on protected routes."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get("/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_valid_token_resolves_user(setup_user):
    """Valid token should resolve the user and return 200."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get(
            "/me",
            headers={"Authorization": "Bearer usertoken"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body.get("is_admin") is False
    assert body["user"]["display_name"] == "User"
    assert body["user"]["pocket_id_sub"] == "user-uuid"


@pytest.mark.asyncio
async def test_admin_token_grants_admin(setup_user):
    """Token with 'admins' group should grant admin."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get(
            "/me",
            headers={"Authorization": "Bearer admintoken"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body.get("is_admin") is True


async def test_background_sync_removes_revoked_admin_group(setup_user, monkeypatch):
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.pocket_id_sub == "admin-uuid"))).scalar_one()
        user.sso_synced_at = utcnow() - timedelta(minutes=6)
        await db.commit()

    async def demoted_user(subject):
        assert subject == "admin-uuid"
        return {"userGroups": [{"name": "members"}]}

    monkeypatch.setattr(middleware, "get_user_by_id", demoted_user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        headers = {"Authorization": "Bearer admintoken"}
        assert (await ac.get("/me", headers=headers)).json()["is_admin"] is True
        await asyncio.gather(*middleware._pending_sso_syncs)
        assert (await ac.get("/me", headers=headers)).json()["is_admin"] is False


@pytest.mark.asyncio
async def test_jit_provisions_new_user_with_groups(setup_user):
    """New Pocket ID user with groups should get provisioned."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get(
            "/me",
            headers={"Authorization": "Bearer newusertoken"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["display_name"] == "New SSO User"
    assert body["user"]["pocket_id_sub"] == "new-sso-user-uuid"


@pytest.mark.asyncio
async def test_jit_rejects_user_without_groups(setup_user):
    """New Pocket ID user with no groups should get 403."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get(
            "/me",
            headers={"Authorization": "Bearer noinvitetoken"},
        )
    assert r.status_code == 403
    assert "group" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_health_route_public(setup_user):
    """Health check should be accessible without auth."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_default_deny_on_data_endpoints(setup_user):
    """Anonymous requests to roster/chat/SSE/weather endpoints must be 401.

    These were the unauthenticated leaks found in the security audit — the
    middleware is default-deny now, so no endpoint relies on its own check.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        for path in (
            "/meetups",
            "/meetups/1",
            "/meetups/1/teams",
            "/meetups/1/scores",
            "/meetups/1/plus-one",
            "/meetups/1/chat",
            "/meetups/1/chat/events",
            "/meetups/1/data/events",
        ):
            r = await ac.get(path)
            assert r.status_code == 401, f"{path} returned {r.status_code}"
        r = await ac.post("/meetups/1/weather/refresh")
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_invalid_token_rejected_everywhere(setup_user):
    """A bogus token must not reach protected endpoints."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get("/meetups", headers={"Authorization": "Bearer bogus-token"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_plus_one_preview_stays_public(setup_user):
    """Guest claim preview is a capability URL — no 401 without a token."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get("/meetups/plus-one/nonexistent-token")
    assert r.status_code == 404  # endpoint reachable, token unknown


@pytest.mark.asyncio
async def test_query_token_only_accepted_on_sse_paths(setup_user):
    """`?access_token=` is honored on SSE paths only, never on regular APIs
    (keeps tokens out of access logs for ordinary calls)."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get("/me?access_token=usertoken")
        assert r.status_code == 401
        # SSE without any token: rejected before streaming starts
        r = await ac.get("/meetups/1/chat/events")
        assert r.status_code == 401
        r = await ac.get("/meetups/1/chat/events?access_token=bogus")
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_existing_user_linked_via_invite_token(setup_user, monkeypatch):
    """Existing user with invite token should be linked to Pocket ID on first auth."""
    from app.models.invite import InviteToken

    # Create an existing user without pocket_id_sub
    async with async_session() as db:
        user = User(sso_display_name="Pre-Existing Player")
        db.add(user)
        await db.flush()
        user_id = user.id

        from datetime import datetime, timedelta

        # Create an invite token linked to this user
        invite = InviteToken(
            token="test-signup-token",
            first_name="Pre-Existing",
            last_name="Player",
            expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(days=7),
            user_id=user_id,
        )
        db.add(invite)
        await db.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        # 'newusertoken' is the signup-token test user (see conftest)
        r = await ac.get(
            "/me",
            headers={"Authorization": "Bearer newusertoken"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    # Should be the existing user, not a new JIT user
    assert body["user"]["id"] == user_id
    assert body["user"]["display_name"] == "New SSO User"  # SSO data synced
    assert body["user"]["pocket_id_sub"] == "new-sso-user-uuid"

    # Verify invite was marked as used
    async with async_session() as db:
        from sqlalchemy import select

        result = await db.execute(
            select(InviteToken).where(InviteToken.token == "test-signup-token")
        )
        invite = result.scalar_one_or_none()
        assert invite is not None
        assert invite.used is True
