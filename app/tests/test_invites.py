import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.main import app
from app.core.database import Base, async_session, engine
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def _fake_ldap_provision(*, email: str, display_name: str | None = None):
    return ("newinv", "pw-test")


@pytest.mark.asyncio
async def test_create_and_verify_invite_provisions_user(monkeypatch):
    sent: list[tuple[str, str]] = []

    async def fake_send(to_email: str, subject: str, text_body: str, html_body=None):
        sent.append((to_email, subject))
        return True

    monkeypatch.setattr("app.api.invites.send_smtp_email", fake_send)
    monkeypatch.setattr("app.services.smtp_mail.send_smtp_email", fake_send)
    monkeypatch.setattr(
        "app.api.invites.provision_ldap_invite_user",
        _fake_ldap_provision,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        inv = await ac.post(
            "/invites/create?email=newinv@example.com",
            headers={"Remote-User": "admin", "Remote-Groups": "admins"},
        )
        assert inv.status_code == 200, inv.text
        link = inv.json()["invite_link"]
        assert "/invites/verify/" in link
        token = link.split("/invites/verify/")[-1]

        r = await ac.get(f"/invites/verify/{token}")
        assert r.status_code == 200
        body = r.json()
        assert "message" in body
        assert body["username"] == "newinv"
        assert body["email"] == "newinv@example.com"

    async with async_session() as db:
        result = await db.execute(select(User).where(User.email == "newinv@example.com"))
        u = result.scalar_one_or_none()
        assert u is not None
        assert u.username == "newinv"

    assert len(sent) >= 2
    subjects = [s[1] for s in sent]
    assert any("invited" in x.lower() or "invite" in x.lower() for x in subjects)
    assert any("ready" in x.lower() for x in subjects)


@pytest.mark.asyncio
async def test_admin_list_invites(monkeypatch):
    async def fake_send(*_a, **_k):
        return True

    monkeypatch.setattr("app.api.invites.send_smtp_email", fake_send)

    transport = ASGITransport(app=app)
    headers = {"Remote-User": "admin", "Remote-Groups": "admins"}
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        c = await ac.post(
            "/invites/create?email=listtest@example.com",
            headers=headers,
        )
        assert c.status_code == 200, c.text

        r = await ac.get("/invites/admin/list", headers=headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        row = next(x for x in data if x["email"] == "listtest@example.com")
        assert "invite_link" in row
        assert row["used"] is False
