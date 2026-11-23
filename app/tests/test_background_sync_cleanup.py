import asyncio
from datetime import timedelta

import pytest
from sqlalchemy import text

from app.api import middleware
from app.core.database import async_session
from app.core.timeutil import utcnow
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


async def test_background_sync_deduplicates_each_subject(monkeypatch):
    started = []
    release = asyncio.Event()

    async def slow_sync(user, pocket_id_sub):
        started.append(pocket_id_sub)
        await release.wait()

    monkeypatch.setattr(middleware, "_sync_sso_data", slow_sync)
    for _ in range(10):
        middleware._background_sync_sso(User(), "subject-a")
    middleware._background_sync_sso(User(), "subject-b")
    await asyncio.sleep(0)
    assert sorted(started) == ["subject-a", "subject-b"]

    tasks = list(middleware._pending_sso_syncs)
    release.set()
    await asyncio.gather(*tasks)
    assert not middleware._syncing_sso_subjects

    middleware._background_sync_sso(User(), "subject-a")
    await asyncio.gather(*middleware._pending_sso_syncs)
    assert started.count("subject-a") == 2


async def test_background_sync_preserves_admin_refresh_interval(monkeypatch):
    started = []

    async def sync(user, pocket_id_sub):
        started.append(pocket_id_sub)

    monkeypatch.setattr(middleware, "_sync_sso_data", sync)
    last_sync = utcnow() - timedelta(minutes=6)
    middleware._background_sync_sso(
        User(sso_groups=["members"], sso_synced_at=last_sync), "member"
    )
    middleware._background_sync_sso(
        User(sso_groups=["admins"], sso_synced_at=last_sync), "group-admin"
    )
    middleware._background_sync_sso(
        User(is_admin=True, sso_synced_at=last_sync), "local-admin"
    )
    middleware._background_sync_sso(
        User(sso_groups=["admins"], sso_synced_at=utcnow()), "fresh-admin"
    )
    await asyncio.gather(*middleware._pending_sso_syncs)
    assert sorted(started) == ["group-admin", "local-admin"]


@pytest.mark.parametrize("cancelled", [False, True])
async def test_background_sync_allows_retry_after_failure_or_cancellation(
    monkeypatch, cancelled
):
    started = asyncio.Event()
    release = asyncio.Event()

    async def failing_sync(user, pocket_id_sub):
        started.set()
        await release.wait()
        raise RuntimeError("Pocket ID unavailable")

    monkeypatch.setattr(middleware, "_sync_sso_data", failing_sync)
    middleware._background_sync_sso(User(), "subject-retry")
    await started.wait()
    task = next(iter(middleware._pending_sso_syncs))
    if cancelled:
        task.cancel()
    else:
        release.set()
    await asyncio.gather(task, return_exceptions=True)
    assert "subject-retry" not in middleware._syncing_sso_subjects

    middleware._background_sync_sso(User(), "subject-retry")
    retry = next(iter(middleware._pending_sso_syncs))
    assert retry is not task
    release.set()
    await asyncio.gather(retry, return_exceptions=True)
