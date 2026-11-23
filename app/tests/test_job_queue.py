"""Durable job queue: rating-reminder rows survive restarts and fire once."""

import asyncio
import sqlite3
from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.job_queue import JobQueue
from app.models.user import User
from app.services import job_queue


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None)


async def _queued_rows(meetup_id: int) -> list[JobQueue]:
    async with AsyncSession(engine) as db:
        return list(
            (
                await db.execute(
                    select(JobQueue).where(JobQueue.ref_id == meetup_id)
                )
            )
            .scalars()
            .all()
        )


@pytest.mark.asyncio
async def test_rating_reminder_queued_repointed_and_dropped():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            db.add(
                User(pocket_id_sub="admin-uuid", sso_display_name="Admin", is_admin=True)
            )
            await db.commit()

        start = datetime.now(UTC) + timedelta(days=1)
        resp = await ac.post(
            "/meetups/",
            json={
                "start_time": start.isoformat(),
                "location": "Pitch",
                "min_players": 1,
                "max_players": 4,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer admin"},
        )
        assert resp.status_code == 201
        meetup_id = resp.json()["id"]

        # Creating the meetup queues a durable rating-reminder job at end time.
        rows = await _queued_rows(meetup_id)
        assert len(rows) == 1
        assert rows[0].job_type == "rating_reminder"
        assert rows[0].run_at == _utc(start + timedelta(hours=2))

        # Moving the meetup re-points the same job (no duplicate row).
        new_start = start + timedelta(hours=2)
        resp = await ac.patch(
            f"/meetups/{meetup_id}",
            json={"start_time": new_start.isoformat()},
            headers={"Authorization": "Bearer admin"},
        )
        assert resp.status_code == 200
        rows = await _queued_rows(meetup_id)
        assert len(rows) == 1
        assert rows[0].run_at == _utc(new_start + timedelta(hours=2))

        # Deleting the meetup drops the queued job.
        resp = await ac.delete(
            f"/meetups/{meetup_id}", headers={"Authorization": "Bearer admin"}
        )
        assert resp.status_code == 200
        assert await _queued_rows(meetup_id) == []


@pytest.mark.asyncio
async def test_run_due_jobs_executes_and_drops_row():
    now = _utc(datetime.now(UTC))
    async with AsyncSession(engine) as db:
        db.add(
            JobQueue(
                job_type="rating_reminder",
                ref_id=99999,  # nonexistent meetup — handler skips cleanly
                run_at=now - timedelta(minutes=1),
                created_at=now,
            )
        )
        db.add(
            JobQueue(
                job_type="rating_reminder",
                ref_id=88888,  # future — must stay queued
                run_at=now + timedelta(hours=1),
                created_at=now,
            )
        )
        await db.commit()

    from app.services.job_queue import run_due_jobs

    assert await run_due_jobs() == 1

    async with AsyncSession(engine) as db:
        remaining = list((await db.execute(select(JobQueue))).scalars().all())
    assert [j.ref_id for j in remaining] == [88888]


@pytest.mark.asyncio
async def test_due_jobs_can_write_and_overlapping_polls_claim_once(monkeypatch):
    now = _utc(datetime.now(UTC))
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    processed = []

    async def handler(ref_id):
        if ref_id == 101:
            first_started.set()
            await release_first.wait()
        async with AsyncSession(engine) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            db.add(User(sso_display_name=f"Job {ref_id}"))
            await db.commit()
        processed.append(ref_id)

    monkeypatch.setitem(job_queue._HANDLERS, "test", lambda: handler)
    async with AsyncSession(engine) as db:
        for ref_id in (101, 102, 103):
            await job_queue.upsert_job(db, "test", ref_id, now - timedelta(minutes=1))
        await db.commit()

    first_poll = asyncio.create_task(job_queue.run_due_jobs())
    try:
        await asyncio.wait_for(first_started.wait(), timeout=1)
        assert await asyncio.wait_for(job_queue.run_due_jobs(), timeout=2) == 2
    finally:
        release_first.set()
        assert await asyncio.wait_for(first_poll, timeout=2) == 1

    assert processed == [102, 103, 101]
    assert await job_queue.run_due_jobs() == 0


@pytest.mark.asyncio
async def test_reschedule_during_handler_keeps_new_schedule(monkeypatch):
    now = _utc(datetime.now(UTC))
    later = now + timedelta(hours=1)

    async def handler(ref_id):
        async with AsyncSession(engine) as db:
            await job_queue.upsert_job(db, "test", ref_id, later)
            await db.commit()

    monkeypatch.setitem(job_queue._HANDLERS, "test", lambda: handler)
    async with AsyncSession(engine) as db:
        await job_queue.upsert_job(db, "test", 101, now - timedelta(minutes=1))
        await db.commit()

    assert await job_queue.run_due_jobs() == 1
    (rescheduled,) = await _queued_rows(101)
    assert rescheduled.run_at == later
    assert rescheduled.claimed_until is None
    assert await job_queue.run_due_jobs() == 0


@pytest.mark.asyncio
async def test_expired_claim_and_sqlite_contention_leave_job_retryable(monkeypatch):
    now = _utc(datetime.now(UTC))
    attempts = 0

    async def handler(_ref_id):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            sqlite_error = sqlite3.OperationalError("database is locked")
            sqlite_error.sqlite_errorcode = sqlite3.SQLITE_BUSY
            raise OperationalError(None, None, sqlite_error)

    monkeypatch.setitem(job_queue._HANDLERS, "test", lambda: handler)
    async with AsyncSession(engine) as db:
        db.add(JobQueue(
            job_type="test", ref_id=101, run_at=now - timedelta(hours=1),
            created_at=now - timedelta(hours=1), claimed_until=now - timedelta(minutes=1),
        ))
        await db.commit()

    assert await job_queue.run_due_jobs() == 0
    (retryable,) = await _queued_rows(101)
    assert retryable.claimed_until is None
    assert await job_queue.run_due_jobs() == 1
    assert await _queued_rows(101) == []
