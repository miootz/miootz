"""Admin session create triggers invite emails when send_invite_emails is true."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.config import settings
from app.core.database import Base, engine
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.mark.asyncio
async def test_create_session_calls_notify_when_send_invite_emails_true():
    notify = AsyncMock()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            u = User(username="adm", email="a@test.com", is_admin=True)
            db.add(u)
            await db.commit()

        start = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        with patch(
            "app.api.sessions.notify_new_session_invites",
            notify,
        ):
            r = await ac.post(
                "/sessions/",
                json={
                    "start_time": start,
                    "location": "Pitch",
                    "min_players": 8,
                    "max_players": 14,
                    "send_invite_emails": True,
                },
                headers={settings.AUTHELIA_USER_HEADER: "adm"},
            )
        assert r.status_code == 201, r.text
        notify.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_session_skips_notify_when_send_invite_emails_false():
    notify = AsyncMock()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            u = User(username="adm2", email="b@test.com", is_admin=True)
            db.add(u)
            await db.commit()

        start = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
        with patch(
            "app.api.sessions.notify_new_session_invites",
            notify,
        ):
            r = await ac.post(
                "/sessions/",
                json={
                    "start_time": start,
                    "location": "Pitch B",
                    "min_players": 8,
                    "max_players": 14,
                    "send_invite_emails": False,
                },
                headers={settings.AUTHELIA_USER_HEADER: "adm2"},
            )
        assert r.status_code == 201, r.text
        notify.assert_not_awaited()
