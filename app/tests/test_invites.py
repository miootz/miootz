"""Tests for user creation and invite flow."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.main import app
from app.core.database import Base, engine, async_session
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as meetup:
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
async def test_admin_create_user(monkeypatch):
    """Admin can create a user without Pocket ID."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/users",
            json={"first_name": "New", "last_name": "Player", "calculated_skill": 3},
            headers={"Authorization": "Bearer admintoken"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["id"] is not None
        assert body["display_name"] == "New Player"
        assert body["pocket_id_sub"] is None
        assert body["has_pocket_id"] is False


@pytest.mark.asyncio
async def test_admin_create_user_requires_names():
    """Creating a user requires first and last name."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/users",
            json={"first_name": "", "last_name": "Player", "calculated_skill": 3},
            headers={"Authorization": "Bearer admintoken"},
        )
        assert r.status_code == 422, r.text  # Pydantic min_length validation


@pytest.mark.asyncio
async def test_admin_create_user_requires_admin(monkeypatch):
    """Non-admin cannot create users."""
    async def _mock_validate_user_token(token: str) -> dict | None:
        if token == "usertoken":
            return {
                "sub": "user-uuid",
                "email": "user@test.com",
                "preferred_username": "user",
                "name": "User",
                "groups": ["members"],
            }
        return None

    monkeypatch.setattr(
        "app.services.pocket_id_jwt.validate_pocket_id_token",
        _mock_validate_user_token,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/users",
            json={"first_name": "User", "last_name": "Test", "calculated_skill": 3},
            headers={"Authorization": "Bearer usertoken"},
        )
        assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_admin_generate_invite_for_user(monkeypatch):
    """Admin can generate a Pocket ID invite for an existing user."""
    async def _mock_create_signup_token(
        email: str,
        ttl: str = "168h",
        usage_limit: int = 1,
        user_group_ids: list[str] | None = None,
    ) -> dict:
        return {
            "token": "pocket-id-test-token-123",
            "expiresAt": "2025-01-01T00:00:00",
        }

    monkeypatch.setattr(
        "app.api.users.create_signup_token",
        _mock_create_signup_token,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # First create a user
        create_r = await ac.post(
            "/users",
            json={"first_name": "Invited", "last_name": "Player", "calculated_skill": 3},
            headers={"Authorization": "Bearer admintoken"},
        )
        assert create_r.status_code == 200
        user_id = create_r.json()["id"]

        # Generate invite
        invite_r = await ac.post(
            f"/users/{user_id}/invite",
            headers={"Authorization": "Bearer admintoken"},
        )
        assert invite_r.status_code == 200, invite_r.text
        body = invite_r.json()
        assert "/st/" in body["invite_link"]
        assert body["expires_at"]


@pytest.mark.asyncio
async def test_admin_generate_invite_rejects_linked_user(monkeypatch):
    """Cannot generate invite for a user who already has Pocket ID."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Admin user already has pocket_id_sub
        r = await ac.post(
            "/users/1/invite",
            headers={"Authorization": "Bearer admintoken"},
        )
        assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_admin_generate_invite_404_for_missing_user(monkeypatch):
    """Generating invite for non-existent user returns 404."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/users/9999/invite",
            headers={"Authorization": "Bearer admintoken"},
        )
        assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_admin_list_invites(monkeypatch):
    """Admin can list invites."""
    async def _mock_create_signup_token(
        email: str,
        ttl: str = "168h",
        usage_limit: int = 1,
        user_group_ids: list[str] | None = None,
    ) -> dict:
        return {
            "token": "pocket-id-test-token-123",
            "expiresAt": "2025-01-01T00:00:00",
        }

    monkeypatch.setattr(
        "app.api.users.create_signup_token",
        _mock_create_signup_token,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Create user + invite
        create_r = await ac.post(
            "/users",
            json={"first_name": "List", "last_name": "Test", "calculated_skill": 3},
            headers={"Authorization": "Bearer admintoken"},
        )
        user_id = create_r.json()["id"]
        await ac.post(
            f"/users/{user_id}/invite",
            headers={"Authorization": "Bearer admintoken"},
        )

        r = await ac.get(
            "/invites/admin/list",
            headers={"Authorization": "Bearer admintoken"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        row = next(x for x in data if x["first_name"] == "List" and x["last_name"] == "Test")
        assert "invite_link" in row
        assert row["used"] is False
        assert row["user_id"] == user_id
