import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.main import app
from app.core.config import settings
from app.core.database import Base, async_session, engine
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def _fake_ldap_provision(*, email: str, display_name: str | None = None):
    return ("newinv", "unused-random-password")


def _fake_ldap_replace(*, uid: str, plaintext: str) -> None:
    assert uid == "newinv"
    assert len(plaintext) >= 10


async def _fake_authelia_login(**_kwargs):
    return (
        ["authelia_session=fake; Path=/; Domain=footylegends.local; HttpOnly; Secure; SameSite=Lax"],
        "https://app.footylegends.local/",
    )


@pytest.mark.asyncio
async def test_create_begin_complete_invite_provisions_user(monkeypatch):
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
    monkeypatch.setattr(
        "app.api.invites.ldap_replace_user_password",
        _fake_ldap_replace,
    )
    monkeypatch.setattr(
        "app.api.invites.authelia_first_factor_login",
        _fake_authelia_login,
    )
    monkeypatch.setattr(settings, "AUTHELIA_INTERNAL_URL", "http://authelia:9091")

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

        b = await ac.post("/invites/verify/begin", json={"token": token})
        assert b.status_code == 200, b.text
        begin = b.json()
        assert begin["username"] == "newinv"
        assert begin["email"] == "newinv@example.com"
        assert begin.get("setup_token")

        c = await ac.post(
            "/invites/verify/complete",
            json={
                "setup_token": begin["setup_token"],
                "password": "longenoughpw",
                "password_confirm": "longenoughpw",
            },
        )
        assert c.status_code == 200, c.text
        body = c.json()
        assert body["username"] == "newinv"
        assert body["redirect"].startswith("https://")

    async with async_session() as db:
        result = await db.execute(select(User).where(User.email == "newinv@example.com"))
        u = result.scalar_one_or_none()
        assert u is not None
        assert u.username == "newinv"

    assert len(sent) == 1
    assert "invited" in sent[0][1].lower() or "invite" in sent[0][1].lower()


@pytest.mark.asyncio
async def test_complete_password_mismatch(monkeypatch):
    async def fake_send(*_a, **_k):
        return True

    monkeypatch.setattr("app.api.invites.send_smtp_email", fake_send)
    monkeypatch.setattr("app.services.smtp_mail.send_smtp_email", fake_send)
    monkeypatch.setattr("app.api.invites.provision_ldap_invite_user", _fake_ldap_provision)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post(
            "/invites/create?email=pw@example.com",
            headers={"Remote-User": "admin", "Remote-Groups": "admins"},
        )
        inv_row = await ac.get("/invites/admin/list", headers={"Remote-User": "admin", "Remote-Groups": "admins"})
        token = next(x["token"] for x in inv_row.json() if x["email"] == "pw@example.com")

        b = await ac.post("/invites/verify/begin", json={"token": token})
        assert b.status_code == 200
        begin = b.json()

        c = await ac.post(
            "/invites/verify/complete",
            json={
                "setup_token": begin["setup_token"],
                "password": "longenoughpw",
                "password_confirm": "otherpassword",
            },
        )
        assert c.status_code == 400


@pytest.mark.asyncio
async def test_deprecated_get_invite_verify_returns_405():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/invites/verify/some-uuid-token")
    assert r.status_code == 405
    assert r.headers.get("allow") == "POST"
    body = r.json()
    assert "detail" in body
    assert "begin" in body["detail"].lower()


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
