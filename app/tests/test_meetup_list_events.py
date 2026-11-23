from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.core.meetup_data_manager import meetup_data_manager
from app.models.game_template import GameTemplate
from app.services.recurring_meetups import _create_template_meetup


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


async def test_manual_create_skip_and_delete_update_open_overviews():
    queue = await meetup_data_manager.subscribe(None)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get("/meetups/data/events")).status_code == 401
            headers = {"Authorization": "Bearer admintoken"}
            response = await client.post("/meetups/", headers=headers, json={
                "start_time": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
                "location": "Pitch",
                "min_players": 1,
                "max_players": 10,
                "send_push_notifications": False,
            })
            assert response.status_code == 201, response.text
            meetup_id = response.json()["id"]
            assert queue.get_nowait() == {"type": "meetup_list_changed"}

            response = await client.post(f"/meetups/{meetup_id}/skip", headers=headers)
            assert response.status_code == 200
            assert queue.get_nowait() == {"type": "meetup_list_changed"}

            response = await client.delete(f"/meetups/{meetup_id}", headers=headers)
            assert response.status_code == 200
            assert queue.get_nowait() == {"type": "meetup_list_changed"}
    finally:
        await meetup_data_manager.unsubscribe(None, queue)


async def test_recurring_meetup_creation_updates_open_overviews():
    queue = await meetup_data_manager.subscribe(None)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            template = GameTemplate(
                name="Practice",
                timezone="UTC",
                weekday=1,
                hour=18,
                minute=0,
                announce_timezone="UTC",
                announce_weekday=0,
                announce_hour=18,
                announce_minute=0,
                location="Pitch",
                min_players=1,
                max_players=10,
            )
            db.add(template)
            await db.commit()
            await db.refresh(template)
            meetup = await _create_template_meetup(db, template, datetime.now(UTC) + timedelta(days=1))
            assert meetup is not None
            assert queue.get_nowait() == {"type": "meetup_list_changed"}
    finally:
        await meetup_data_manager.unsubscribe(None, queue)
