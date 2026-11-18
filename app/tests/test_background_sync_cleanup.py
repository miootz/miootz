import asyncio

import pytest
from sqlalchemy import text

from app.api import middleware
from app.core.database import async_session
from app.models.user import User


@pytest.fixture(scope="module")
def completed_background_sync():
    completed = []
    yield completed
    assert completed == [True]


async def test_background_sync_finishes_before_test_loop_closes(
    monkeypatch, completed_background_sync
):
    started = asyncio.Event()

    async def slow_sync(user, pocket_id_sub):
        async with async_session() as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            started.set()
            await asyncio.sleep(0.1)
            await db.rollback()
        completed_background_sync.append(True)

    monkeypatch.setattr(middleware, "_sync_sso_data", slow_sync)
    middleware._background_sync_sso(User(), "test-subject")
    await asyncio.wait_for(started.wait(), timeout=5)
