"""Tests for Phase 2 Sub-task 1: Session CRUD, attendance, and admin actions."""

from datetime import datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.session import Attendance, GameSession
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


async def _create_user(db: AsyncSession, display_name: str, pocket_id_sub: str, is_admin: bool = False) -> User:
    user = User(pocket_id_sub=pocket_id_sub, sso_display_name=display_name, is_admin=is_admin)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_create_session_as_admin():
    """Admin can create a session."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await _create_user(db, "adminadm", "adminadm-uuid", is_admin=True)

        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": (datetime.utcnow() + timedelta(days=1)).isoformat(),
                "location": "Test Pitch",
                "min_players": 1,
                "max_players": 10,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer adminadm"},
        )
        assert resp.status_code == 201, resp.text
        session = resp.json()
        assert session["location"] == "Test Pitch"


@pytest.mark.asyncio
async def test_join_session_as_player():
    """Player can join a session."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await _create_user(db, "adminadm", "adminadm-uuid", is_admin=True)
            await _create_user(db, "p1", "p1-uuid")

        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": (datetime.utcnow() + timedelta(days=1)).isoformat(),
                "location": "Test Pitch",
                "min_players": 1,
                "max_players": 10,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer adminadm"},
        )
        session_id = resp.json()["id"]

        join_resp = await ac.post(
            f"/sessions/{session_id}/join",
            headers={"Authorization": "Bearer p1"},
        )
        assert join_resp.status_code == 200, join_resp.text
        assert join_resp.json()["status"] == "confirmed"


@pytest.mark.asyncio
async def test_leave_session():
    """Player can leave a session."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await _create_user(db, "adminadm", "adminadm-uuid", is_admin=True)
            await _create_user(db, "p1", "p1-uuid")

        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": (datetime.utcnow() + timedelta(days=1)).isoformat(),
                "location": "Test Pitch",
                "min_players": 1,
                "max_players": 10,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer adminadm"},
        )
        session_id = resp.json()["id"]

        await ac.post(
            f"/sessions/{session_id}/join",
            headers={"Authorization": "Bearer p1"},
        )

        leave_resp = await ac.delete(
            f"/sessions/{session_id}/leave",
            headers={"Authorization": "Bearer p1"},
        )
        assert leave_resp.status_code == 200, leave_resp.text


@pytest.mark.asyncio
async def test_admin_can_manage_attendance():
    """Admin can move players between confirmed/waitlisted."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await _create_user(db, "adminadm", "adminadm-uuid", is_admin=True)
            p1 = await _create_user(db, "p1", "p1-uuid")

        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": (datetime.utcnow() + timedelta(days=1)).isoformat(),
                "location": "Test Pitch",
                "min_players": 1,
                "max_players": 10,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer adminadm"},
        )
        session_id = resp.json()["id"]

        await ac.post(
            f"/sessions/{session_id}/join",
            headers={"Authorization": "Bearer p1"},
        )

        move_resp = await ac.post(
            f"/sessions/{session_id}/admin/move?user_id={p1.id}&new_status=waitlisted",
            headers={"Authorization": "Bearer adminadm"},
        )
        assert move_resp.status_code == 200, move_resp.text
        assert move_resp.json()["status"] == "moved"


@pytest.mark.asyncio
async def test_non_admin_cannot_create_session():
    """Non-admin users cannot create sessions."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await _create_user(db, "p1", "p1-uuid")

        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": (datetime.utcnow() + timedelta(days=1)).isoformat(),
                "location": "Test Pitch",
                "min_players": 1,
                "max_players": 10,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer p1"},
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_session_list_shows_active_sessions():
    """GET /sessions/ returns active sessions."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await _create_user(db, "adminadm", "adminadm-uuid", is_admin=True)
            await _create_user(db, "p1", "p1-uuid")

        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": (datetime.utcnow() + timedelta(days=1)).isoformat(),
                "location": "Test Pitch",
                "min_players": 1,
                "max_players": 10,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer adminadm"},
        )
        assert resp.status_code == 201

        list_resp = await ac.get(
            "/sessions/?status=upcoming",
            headers={"Authorization": "Bearer p1"},
        )
        assert list_resp.status_code == 200, list_resp.text
        data = list_resp.json()
        sessions = data.get("items", [])
        assert any(s["location"] == "Test Pitch" for s in sessions)
