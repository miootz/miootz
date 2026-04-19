"""Game templates + materialize + sessions API (weekly templates + notify)."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.config import settings
from app.core.database import Base, engine
from app.models.game_template import GameTemplate
from app.models.session import GameSession
from app.models.user import User
from app.services.recurring_sessions import (
    materialize_next_session_and_notify,
    next_occurrence_utc,
    utc_start_matches_rule,
)


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def test_utc_start_matches_rule_europe_london():
    # 2024-06-03 is Monday; 18:00 in London = 17:00 UTC (BST)
    start = datetime(2024, 6, 3, 17, 0, tzinfo=timezone.utc)
    assert utc_start_matches_rule(start, "Europe/London", 0, 18, 0) is True
    assert utc_start_matches_rule(start, "Europe/London", 1, 18, 0) is False


def test_next_occurrence_skips_same_week_if_time_passed():
    rule = GameTemplate(
        name="Test",
        timezone="UTC",
        weekday=0,
        hour=10,
        minute=0,
        announce_timezone="UTC",
        announce_weekday=3,
        announce_hour=9,
        announce_minute=0,
        location="Pitch",
        fee=0.0,
        min_players=10,
        max_players=15,
        waitlist_mode="auto_promote",
        is_active=True,
    )
    # Monday 2024-06-03 11:00 UTC — next Monday 10:00 is 2024-06-10
    after = datetime(2024, 6, 3, 11, 0, tzinfo=timezone.utc)
    n = next_occurrence_utc(rule, after)
    assert n == datetime(2024, 6, 10, 10, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_materialize_next_idempotent():
    async with AsyncSession(engine) as db:
        rule = GameTemplate(
            name="Test",
            timezone="UTC",
            weekday=2,
            hour=12,
            minute=0,
            announce_timezone="UTC",
            announce_weekday=1,
            announce_hour=8,
            announce_minute=0,
            location="Pitch",
            fee=0.0,
            min_players=10,
            max_players=15,
            waitlist_mode="auto_promote",
            is_active=True,
        )
        db.add(rule)
        await db.flush()
        rule_id = rule.id

        anchor = datetime(2030, 1, 1, 12, 0, tzinfo=timezone.utc)
        first = GameSession(
            start_time=anchor,
            location="Pitch",
            fee=0.0,
            min_players=10,
            max_players=15,
            waitlist_mode="auto_promote",
            game_template_id=rule.id,
        )
        db.add(first)
        await db.commit()

    with patch(
        "app.services.recurring_sessions.notify_new_session_invites",
        new_callable=AsyncMock,
    ):
        a1 = await materialize_next_session_and_notify(rule_id)
        a2 = await materialize_next_session_and_notify(rule_id)
    assert a1 in (True, False)
    assert a2 is False


@pytest.mark.asyncio
async def test_create_game_template_admin():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            u = User(username="adm", email="a@test.com", is_admin=True)
            db.add(u)
            await db.commit()

        body = {
            "name": "Monday pitch",
            "timezone": "UTC",
            "weekday": 0,
            "hour": 18,
            "minute": 0,
            "announce_timezone": "UTC",
            "announce_weekday": 3,
            "announce_hour": 10,
            "announce_minute": 0,
            "location": "Field A",
            "fee": 5.0,
            "min_players": 8,
            "max_players": 14,
            "waitlist_mode": "auto_promote",
            "is_active": True,
        }
        r = await ac.post(
            "/game-templates/",
            json=body,
            headers={settings.AUTHELIA_USER_HEADER: "adm"},
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["id"] is not None
        assert data["is_active"] is True
        assert data["announce_weekday"] == 3
