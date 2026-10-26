"""Durable job queue: rating-reminder rows survive restarts and fire once."""

from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.job_queue import JobQueue
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None)


async def _queued_rows(session_id: int) -> list[JobQueue]:
    async with AsyncSession(engine) as db:
        return list(
            (
                await db.execute(
                    select(JobQueue).where(JobQueue.ref_id == session_id)
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
            "/sessions/",
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
        session_id = resp.json()["id"]

        # Creating the session queues a durable rating-reminder job at end time.
        rows = await _queued_rows(session_id)
        assert len(rows) == 1
        assert rows[0].job_type == "rating_reminder"
        assert rows[0].run_at == _utc(start + timedelta(minutes=60))

        # Moving the session re-points the same job (no duplicate row).
        new_start = start + timedelta(hours=2)
        resp = await ac.patch(
            f"/sessions/{session_id}",
            json={"start_time": new_start.isoformat()},
            headers={"Authorization": "Bearer admin"},
        )
        assert resp.status_code == 200
        rows = await _queued_rows(session_id)
        assert len(rows) == 1
        assert rows[0].run_at == _utc(new_start + timedelta(minutes=60))

        # Deleting the session drops the queued job.
        resp = await ac.delete(
            f"/sessions/{session_id}", headers={"Authorization": "Bearer admin"}
        )
        assert resp.status_code == 200
        assert await _queued_rows(session_id) == []


@pytest.mark.asyncio
async def test_run_due_jobs_executes_and_drops_row():
    now = _utc(datetime.now(UTC))
    async with AsyncSession(engine) as db:
        db.add(
            JobQueue(
                job_type="rating_reminder",
                ref_id=99999,  # nonexistent session — handler skips cleanly
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
