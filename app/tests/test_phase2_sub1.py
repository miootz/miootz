from io import BytesIO

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

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
    buf = BytesIO()
    Image.new("RGB", (120, 100), color=(200, 100, 50)).save(buf, format="JPEG")
    jpeg_bytes = buf.getvalue()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        files = {"file": ("test.jpg", jpeg_bytes, "image/jpeg")}
        response = await ac.post(
            "/users/me/avatar", files=files, headers=_auth_headers()
        )
        assert response.status_code == 200
        data = response.json()
        assert "/uploads/" in data["profile_pic"]
        assert data["profile_pic"].endswith(".jpg")
        assert "/uploads/" in data["profile_pic_original"]
        assert "_src." in data["profile_pic_original"]
        acp = data["avatar_crop_pixels"]
        assert acp["width"] == acp["height"]
        assert acp["x"] >= 0 and acp["y"] >= 0


@pytest.mark.asyncio
async def test_avatar_crop(setup_db):
    buf = BytesIO()
    Image.new("RGB", (200, 160), color=(10, 90, 200)).save(buf, format="JPEG")
    jpeg_bytes = buf.getvalue()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        up = await ac.post(
            "/users/me/avatar",
            files={"file": ("a.jpg", jpeg_bytes, "image/jpeg")},
            headers=_auth_headers(),
        )
        assert up.status_code == 200
        r = await ac.post(
            "/users/me/avatar/crop",
            json={"crop_pixels": {"x": 20, "y": 10, "width": 80, "height": 80}},
            headers=_auth_headers(),
        )
        assert r.status_code == 200
        out = r.json()
        assert "/uploads/avatar_" in out["profile_pic"]
        assert "avatar_crop_pixels" in out
        assert out["avatar_crop_pixels"]["width"] > 0


@pytest.mark.asyncio
async def test_avatar_rejects_wrong_content_type(setup_db):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        files = {"file": ("x.gif", b"x", "image/gif")}
        response = await ac.post(
            "/users/me/avatar", files=files, headers=_auth_headers()
        )
        assert response.status_code == 400


@pytest.mark.asyncio
async def test_me_includes_sso_snapshot(setup_db):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get(
            "/me",
            headers={
                settings.AUTHELIA_USER_HEADER: "testuser",
                settings.AUTHELIA_NAME_HEADER: "SSO Display",
                settings.AUTHELIA_EMAIL_HEADER: "test@example.com",
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["sso"] is not None
        assert body["sso"]["display_name"] == "SSO Display"
        assert body["sso"]["email"] == "test@example.com"


@pytest.mark.asyncio
async def test_sync_display_name_from_sso(setup_db):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        patch = await ac.patch(
            "/users/me",
            json={"sync_display_name_from_sso": True},
            headers={
                settings.AUTHELIA_USER_HEADER: "testuser",
                settings.AUTHELIA_NAME_HEADER: "Authelia Name",
            },
        )
        assert patch.status_code == 200
        me = await ac.get(
            "/me",
            headers={
                settings.AUTHELIA_USER_HEADER: "testuser",
                settings.AUTHELIA_NAME_HEADER: "Authelia Name",
            },
        )
        assert me.json()["user"]["full_name"] == "Authelia Name"


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
