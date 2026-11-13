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
        user = User(pocket_id_sub="testuser-uuid", sso_display_name="testuser", is_admin=False)
        meetup.add(user)
        await meetup.commit()
    yield


def _auth_headers():
    return {"Authorization": "Bearer testuser"}


@pytest.mark.asyncio
async def test_profile_update():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.patch(
            "/users/me",
            json={"primary_specialty": "ATT"},
            headers=_auth_headers(),
        )
        assert response.status_code == 200
        assert response.json()["message"] == "Profile updated successfully"


@pytest.mark.asyncio
async def test_me_includes_user_data():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get(
            "/me",
            headers=_auth_headers(),
        )
        assert r.status_code == 200
        body = r.json()
        assert "pocket_id_sub" in body["user"]
        assert "display_name" in body["user"]
        assert body["user"]["pocket_id_sub"] == "testuser-uuid"


@pytest.mark.asyncio
async def test_profile_update_specialty():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        patch = await ac.patch(
            "/users/me",
            json={"primary_specialty": "ATT", "secondary_specialty": "MID"},
            headers=_auth_headers(),
        )
        assert patch.status_code == 200
        me = await ac.get("/me", headers=_auth_headers())
        assert me.json()["user"]["primary_specialty"] == "ATT"
        assert me.json()["user"]["secondary_specialty"] == "MID"
