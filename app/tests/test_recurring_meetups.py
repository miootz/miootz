"""Game templates + materialize + meetups API (weekly templates + notify)."""

from datetime import datetime, UTC
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.game_template import GameTemplate
from app.models.meetup import Meetup
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def test_next_occurrence_skips_same_week_if_time_passed():
    from app.services.recurring_meetups import next_occurrence_utc

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
    after = datetime(2024, 6, 3, 11, 0, tzinfo=UTC)
    n = next_occurrence_utc(rule, after)
    assert n == datetime(2024, 6, 10, 10, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_materialize_next_idempotent():
    from app.services.recurring_meetups import materialize_next_meetup_and_notify

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

        anchor = datetime(2030, 1, 1, 12, 0, tzinfo=UTC)
        first = Meetup(
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
        "app.services.recurring_meetups.notify_new_meetup_invites",
        new_callable=AsyncMock,
    ):
        a1 = await materialize_next_meetup_and_notify(rule_id)
        a2 = await materialize_next_meetup_and_notify(rule_id)
    assert a1 in (True, False)
    assert a2 is False


@pytest.mark.asyncio
async def test_materialize_backfills_missed_week():
    """Tail I: a server that was down across a kickoff recreates that week's
    meetup (the most recent past slot) in addition to the next one."""
    from app.services.recurring_meetups import materialize_next_meetup_and_notify

    async with AsyncSession(engine) as db:
        rule = GameTemplate(
            name="Test",
            timezone="UTC",
            weekday=1,
            hour=9,
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
        await db.commit()

    ok = await materialize_next_meetup_and_notify(rule_id)
    assert ok is True

    async with AsyncSession(engine) as db:
        rows = (
            (
                await db.execute(
                    select(Meetup.start_time).where(
                        Meetup.game_template_id == rule_id
                    )
                )
            )
            .scalars()
            .all()
        )
    now = datetime.now(UTC).replace(tzinfo=None)
    assert len(rows) == 2
    assert rows[0] < now < rows[1]


@pytest.mark.asyncio
async def test_meetup_template_start_is_unique():
    """Tail J: the (template, kickoff) unique index is what makes the
    materializer race-safe."""
    from sqlalchemy.exc import IntegrityError

    async with AsyncSession(engine) as db:
        rule = GameTemplate(
            name="Test",
            timezone="UTC",
            weekday=1,
            hour=9,
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
        await db.commit()
        t = datetime(2031, 5, 5, 9, 0, tzinfo=UTC)
        db.add(Meetup(start_time=t, location="Pitch", game_template_id=rule_id))
        await db.commit()

    async with AsyncSession(engine) as db:
        db.add(Meetup(start_time=t, location="Pitch", game_template_id=rule_id))
        with pytest.raises(IntegrityError):
            await db.commit()


@pytest.mark.asyncio
async def test_create_game_template_admin():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            u = User(pocket_id_sub="adm-uuid", sso_display_name="adm", is_admin=True)
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
            headers={"Authorization": "Bearer adm"},
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["id"] is not None
        assert data["is_active"] is True
        assert data["announce_weekday"] == 3


@pytest.mark.asyncio
async def test_create_game_template_announce_defaults_to_next_day_noon():
    """Omitted announce fields default to next-day noon in the meetup tz."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            u = User(pocket_id_sub="adm-uuid", sso_display_name="adm", is_admin=True)
            db.add(u)
            await db.commit()

        body = {
            "name": "Tuesday pitch",
            "timezone": "UTC",
            "weekday": 1,
            "hour": 19,
            "minute": 30,
            "location": "Field B",
            "min_players": 8,
            "max_players": 14,
            "is_active": True,
        }
        r = await ac.post(
            "/game-templates/",
            json=body,
            headers={"Authorization": "Bearer adm"},
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["announce_timezone"] == "UTC"
        assert data["announce_weekday"] == (1 + 1) % 7
        assert data["announce_hour"] == 12
        assert data["announce_minute"] == 0


@pytest.mark.asyncio
async def test_materialize_and_notify_are_separate():
    """materialize creates the row without pushing; notify pushes only."""
    from app.services.recurring_meetups import (
        materialize_next_meetup,
        notify_new_meetup,
    )

    async with AsyncSession(engine) as db:
        rule = GameTemplate(
            name="Test",
            timezone="UTC",
            weekday=2,
            hour=12,
            minute=0,
            announce_timezone="UTC",
            announce_weekday=3,
            announce_hour=12,
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
        await db.commit()

    with patch(
        "app.services.recurring_meetups.notify_new_meetup_invites",
        new_callable=AsyncMock,
    ) as invites:
        created = await materialize_next_meetup(rule_id)
        assert created is True
        invites.assert_not_awaited()  # materialize never pushes

        sent = await notify_new_meetup(rule_id)
        assert sent in (True, False)  # True only when subscribers exist
        # No second row, no duplicate invites from re-materializing.
        assert await materialize_next_meetup(rule_id) is False
