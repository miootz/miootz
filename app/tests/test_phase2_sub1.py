import pytest
from httpx import ASGITransport, AsyncClient

from app.api.main import app
from app.core.config import settings
from app.core.database import Base, engine, async_session
from app.models.user import User


@pytest.fixture(scope="module")
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        user = User(username="testuser", email="test@example.com", is_admin=False)
        session.add(user)
        await session.commit()


def _auth_headers():
    return {settings.AUTHELIA_USER_HEADER: "testuser"}


@pytest.mark.asyncio
async def test_profile_update(setup_db):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.patch(
            "/users/me",
            json={"full_name": "John Doe", "skill_level": 3},
            headers=_auth_headers(),
        )
        assert response.status_code == 200
        assert response.json()["message"] == "Profile updated successfully"


@pytest.mark.asyncio
async def test_avatar_upload(setup_db):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        files = {"file": ("test.jpg", b"fake image content", "image/jpeg")}
        response = await ac.post(
            "/users/me/avatar", files=files, headers=_auth_headers()
        )
        assert response.status_code == 200
        assert "profile_pic" in response.json()
        assert "/uploads/" in response.json()["profile_pic"]


@pytest.mark.asyncio
async def test_sms_auth_flow(setup_db):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        # Request OTP
        req_res = await ac.post("/auth/sms/request?phone=+123456789")
        assert req_res.status_code == 200
        otp = req_res.json()["message"].split(": ")[1].replace(")", "")

        # Verify OTP
        ver_res = await ac.post(f"/auth/sms/verify?phone=+123456789&otp={otp}")
        assert ver_res.status_code == 200
        assert "Authenticated successfully" in ver_res.json()["message"]
