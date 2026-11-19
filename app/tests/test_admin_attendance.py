import asyncio
from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.meetup import Attendance, Meetup
from app.models.user import User


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSession(engine) as db:
        db.add_all(
            [
                User(
                    pocket_id_sub="admin-uuid", sso_display_name="Admin", is_admin=True
                ),
                User(pocket_id_sub="user-uuid", sso_display_name="User"),
                User(pocket_id_sub="p1-uuid", sso_display_name="Player one"),
                User(pocket_id_sub="p2-uuid", sso_display_name="Player two"),
                User(pocket_id_sub="p3-uuid", sso_display_name="Player three"),
                User(pocket_id_sub="p4-uuid", sso_display_name="Player four"),
            ]
        )
        db.add(
            Meetup(
                start_time=datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1),
                location="Pitch",
                min_players=1,
                max_players=2,
            )
        )
        await db.commit()


@pytest.mark.asyncio
async def test_admin_adds_attendance_and_rejects_existing_records():
    async with AsyncSession(engine) as db:
        users = {u.pocket_id_sub: u.id for u in (await db.scalars(select(User))).all()}
        meetup_id = await db.scalar(select(Meetup.id))
        db.add_all(
            [
                Attendance(
                    meetup_id=meetup_id, user_id=users["p1-uuid"], status="confirmed"
                ),
                Attendance(
                    meetup_id=meetup_id, user_id=users["p2-uuid"], status="waitlisted"
                ),
                Attendance(
                    meetup_id=meetup_id, user_id=users["p3-uuid"], status="cancelled"
                ),
            ]
        )
        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        url = f"/meetups/{meetup_id}/admin/attendance"
        for sub in ("p1-uuid", "p2-uuid", "p3-uuid"):
            response = await client.post(
                url,
                params={"user_id": users[sub]},
                headers={"Authorization": "Bearer admin"},
            )
            assert response.status_code == 409
        response = await client.post(
            url,
            params={"user_id": users["p4-uuid"]},
            headers={"Authorization": "Bearer user"},
        )
        assert response.status_code == 403
        response = await client.post(
            url,
            params={"user_id": users["p4-uuid"]},
            headers={"Authorization": "Bearer admin"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "confirmed"
        response = await client.post(
            url,
            params={"user_id": users["user-uuid"]},
            headers={"Authorization": "Bearer admin"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "waitlisted"
        response = await client.post(
            url,
            params={"user_id": users["p4-uuid"]},
            headers={"Authorization": "Bearer admin"},
        )
        assert response.status_code == 409

    async with AsyncSession(engine) as db:
        rows = (
            await db.scalars(
                select(Attendance).where(Attendance.meetup_id == meetup_id)
            )
        ).all()
        assert len(rows) == 5
        assert {row.user_id: row.status for row in rows}[
            users["p4-uuid"]
        ] == "confirmed"
        assert (await db.get(Meetup, meetup_id)).content_revision == 2


@pytest.mark.asyncio
async def test_member_join_and_admin_add_cannot_duplicate_attendance():
    async with AsyncSession(engine) as db:
        user_id = await db.scalar(
            select(User.id).where(User.pocket_id_sub == "user-uuid")
        )
        meetup_id = await db.scalar(select(Meetup.id))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        admin, member = await asyncio.gather(
            client.post(
                f"/meetups/{meetup_id}/admin/attendance",
                params={"user_id": user_id},
                headers={"Authorization": "Bearer admin"},
            ),
            client.post(
                f"/meetups/{meetup_id}/join", headers={"Authorization": "Bearer user"}
            ),
        )
        assert sorted([admin.status_code, member.status_code]) in (
            [200, 400],
            [200, 409],
        )

    async with AsyncSession(engine) as db:
        rows = (
            await db.scalars(
                select(Attendance).where(
                    Attendance.meetup_id == meetup_id, Attendance.user_id == user_id
                )
            )
        ).all()
        assert len(rows) == 1
        assert (await db.get(Meetup, meetup_id)).content_revision == 1
