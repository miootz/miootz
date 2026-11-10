"""Tests for the audit log: fire-and-forget writes, non-blocking failures,
admin-only read API, filters, pivot and retention pruning."""

import asyncio
import time
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.main import app
from app.core.audit_db import audit_engine, audit_session
from app.core.database import Base, engine, async_session
from app.core.timeutil import utcnow
from app.models.audit import AuditBase, AuditLog
from app.models.user import User

ADMIN = {"Authorization": "Bearer admintoken"}
USER = {"Authorization": "Bearer usertoken"}


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with audit_engine.begin() as conn:
        await conn.run_sync(AuditBase.metadata.drop_all)
        await conn.run_sync(AuditBase.metadata.create_all)
    async with async_session() as db:
        db.add(
            User(
                pocket_id_sub="admin-uuid",
                sso_display_name="Admin",
                sso_preferred_username="admin",
                sso_groups=["admins", "members"],
            )
        )
        await db.commit()
    yield


async def _audit_rows() -> list[AuditLog]:
    async with audit_session() as db:
        return list((await db.execute(select(AuditLog))).scalars().all())


async def _wait_audit(predicate, timeout: float = 3.0) -> list[AuditLog] | None:
    """Poll until the fire-and-forget audit task(s) have landed."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rows = await _audit_rows()
        if predicate(rows):
            return rows
        await asyncio.sleep(0.01)
    return None


async def _create_meetup(ac: AsyncClient) -> int:
    r = await ac.post(
        "/meetups/",
        json={
            "start_time": (utcnow() + timedelta(days=1)).isoformat(),
            "location": "Audit Pitch",
            "min_players": 1,
            "max_players": 20,
            "send_push_notifications": False,
        },
        headers=ADMIN,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_admin_action_is_logged():
    """An admin action lands in the audit DB with who/what/when."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/users",
            json={"first_name": "Audited", "last_name": "Player"},
            headers=ADMIN,
        )
        assert r.status_code == 200, r.text

        rows = await _wait_audit(lambda rows: len(rows) == 1)
        assert rows is not None
        row = rows[0]
        assert row.category == "user"
        assert row.action == "user.created"
        assert row.is_admin is True
        assert row.username == "admin"
        assert row.display_name == "Admin"
        assert "Audited Player" in row.description
        assert row.created_at is not None
        assert row.meetup_id is None


@pytest.mark.asyncio
async def test_user_action_is_logged_with_meetup_id():
    """A user action is logged with the admin flag False and the meetup id."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        meetup_id = await _create_meetup(ac)
        r = await ac.post(f"/meetups/{meetup_id}/join", headers=USER)
        assert r.status_code == 200, r.text

        # Two rows exist (meetup.created by admin + attendance.joined by user)
        rows = await _wait_audit(lambda rows: len(rows) == 2)
        assert rows is not None
        join = next(r for r in rows if r.action == "attendance.joined")
        assert join.is_admin is False
        assert join.category == "attendance"
        assert join.meetup_id == meetup_id
        # Mock Pocket ID returns no preferredUsername, so the audit falls
        # back to the cached display name for the username.
        assert join.username == "User"
        created = next(r for r in rows if r.action == "meetup.created")
        assert created.is_admin is True
        assert created.meetup_id == meetup_id


@pytest.mark.asyncio
async def test_audit_write_failure_does_not_block_action(monkeypatch):
    """A dead audit database must not fail the action being logged."""
    def _broken_session():
        raise OSError("audit db offline")

    monkeypatch.setattr("app.services.audit.audit_session", _broken_session)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/users",
            json={"first_name": "Resilient", "last_name": "Player"},
            headers=ADMIN,
        )
        assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_list_logs_requires_admin():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        assert (
            await ac.get("/audit/logs", headers=USER)
        ).status_code == 403
        assert (await ac.get("/audit/logs")).status_code == 401


@pytest.mark.asyncio
async def test_list_logs_filters_and_pivot():
    """Search, category filter, date range, pagination and pivot counts."""
    async with audit_session() as db:
        base = utcnow()
        db.add_all(
            [
                AuditLog(
                    created_at=base - timedelta(hours=5),
                    user_id=1, username="admin", display_name="Admin", is_admin=True,
                    category="meetup", action="meetup.created",
                    description="Created meetup 'Old Pitch'", meetup_id=1,
                ),
                AuditLog(
                    created_at=base - timedelta(hours=1),
                    user_id=2, username="user", display_name="User", is_admin=False,
                    category="attendance", action="attendance.joined",
                    description="Joined 'Old Pitch'", meetup_id=1,
                ),
                AuditLog(
                    created_at=base,
                    user_id=2, username="user", display_name="User", is_admin=False,
                    category="attendance", action="attendance.left",
                    description="Left 'Old Pitch'", meetup_id=1,
                ),
                AuditLog(
                    created_at=base,
                    user_id=1, username="admin", display_name="Admin", is_admin=True,
                    category="meetup", action="meetup.deleted",
                    description="Deleted meetup 'Old Pitch'", meetup_id=1,
                ),
            ]
        )
        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/audit/logs", headers=ADMIN)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 4
        # Newest first by default
        assert [i["action"] for i in body["items"]][:2] == [
            "meetup.deleted",
            "attendance.left",
        ]

        # Category filter
        r = await ac.get("/audit/logs", params={"category": "attendance"}, headers=ADMIN)
        assert r.json()["total"] == 2

        # Text search across description/username
        r = await ac.get("/audit/logs", params={"q": "deleted"}, headers=ADMIN)
        assert r.json()["total"] == 1
        r = await ac.get("/audit/logs", params={"q": "user"}, headers=ADMIN)
        assert r.json()["total"] == 2

        # Date range (start excludes the 5 h-old row)
        r = await ac.get(
            "/audit/logs",
            params={"start": (base - timedelta(hours=2)).isoformat()},
            headers=ADMIN,
        )
        assert r.json()["total"] == 3

        # Pagination
        r = await ac.get(
            "/audit/logs", params={"limit": 2, "offset": 2}, headers=ADMIN
        )
        assert r.json()["total"] == 4
        assert len(r.json()["items"]) == 2

        # Pivot by category
        r = await ac.get(
            "/audit/logs", params={"group_by": "category"}, headers=ADMIN
        )
        assert r.json()["items"] == [
            {"key": "attendance", "count": 2},
            {"key": "meetup", "count": 2},
        ]
        # Pivot by user
        r = await ac.get("/audit/logs", params={"group_by": "user"}, headers=ADMIN)
        assert {i["key"] for i in r.json()["items"]} == {"admin", "user"}


@pytest.mark.asyncio
async def test_prune_removes_old_rows():
    from app.services.audit import prune_audit_log

    async with audit_session() as db:
        db.add_all(
            [
                AuditLog(
                    created_at=utcnow() - timedelta(days=100),
                    category="meetup", action="meetup.created", description="old",
                ),
                AuditLog(
                    created_at=utcnow() - timedelta(hours=1),
                    category="meetup", action="meetup.created", description="new",
                ),
            ]
        )
        await db.commit()

    await prune_audit_log(90)

    rows = await _audit_rows()
    assert len(rows) == 1
    assert rows[0].description == "new"
