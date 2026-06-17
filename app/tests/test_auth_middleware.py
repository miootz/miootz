"""Tests for Pocket ID JWT auth middleware."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.main import app
from app.core.database import async_session, engine, Base

from app.models.user import User


@pytest.fixture(scope="function")
async def setup_user():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as session:
        session.add(
            User(
                pocket_id_sub="user-uuid",
                sso_display_name="User",
                sso_groups=["members"],
            )
        )
        session.add(
            User(
                pocket_id_sub="admin-uuid",
                sso_display_name="Admin",
                sso_groups=["admins", "members"],
            )
        )
        await session.commit()
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
            expires_at=datetime.utcnow() + timedelta(days=7),
            user_id=user_id,
        )
        db.add(invite)
        await db.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        # newusertoken has signup_token="test-signup-token" in conftest
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
        result = await db.execute(select(InviteToken).where(InviteToken.token == "test-signup-token"))
        invite = result.scalar_one_or_none()
        assert invite is not None
        assert invite.used is True
