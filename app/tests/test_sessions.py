import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.main import app
from app.core.database import Base, engine
from app.models.user import User
from app.models.session import Attendance
from datetime import datetime, timedelta, UTC


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


async def create_test_user(
    db: AsyncSession, display_name: str, pocket_id_sub: str, is_admin: bool = False
) -> User:
    user = User(
        pocket_id_sub=pocket_id_sub, sso_display_name=display_name, is_admin=is_admin
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_session_lifecycle():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Setup Users
        async with AsyncSession(engine) as db:
            await create_test_user(db, "admin", "admin-uuid", is_admin=True)
            await create_test_user(db, "p1", "p1-uuid")
            await create_test_user(db, "p2", "p2-uuid")
            await create_test_user(db, "p3", "p3-uuid")

        # 2. Create Session (admin only)
        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": (
                    datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1)
                ).isoformat(),
                "location": "Test Pitch",
                "min_players": 1,
                "max_players": 2,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer admin"},
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]

        # 3. Join Session (P1) - Confirmed
        resp = await ac.post(
            f"/sessions/{session_id}/join",
            headers={"Authorization": "Bearer p1"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"

        # 4. Join Session (P2) - Confirmed
        resp = await ac.post(
            f"/sessions/{session_id}/join",
            headers={"Authorization": "Bearer p2"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"

        # 5. Join Session (P3) - Waitlisted (Capacity 2)
        resp = await ac.post(
            f"/sessions/{session_id}/join",
            headers={"Authorization": "Bearer p3"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "waitlisted"

        # 6. P1 Leaves - P3 should be promoted
        resp = await ac.delete(
            f"/sessions/{session_id}/leave",
            headers={"Authorization": "Bearer p1"},
        )
        assert resp.status_code == 200

        # Verify P3 is now confirmed
        async with AsyncSession(engine) as db:
            from sqlalchemy import select

            res = await db.execute(select(User).where(User.pocket_id_sub == "p3-uuid"))
            u = res.scalar()
            assert u is not None
            user_id = u.id
            res_att = await db.execute(
                select(Attendance).where(Attendance.user_id == user_id)
            )
            att = res_att.scalar()
            assert att is not None
            assert att.status == "confirmed"


@pytest.mark.asyncio
async def test_admin_override():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await create_test_user(db, "admin2", "admin2-uuid", is_admin=True)
            await create_test_user(db, "p1_2", "p1_2-uuid")

        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": datetime.now(UTC).replace(tzinfo=None).isoformat(),
                "location": "Override Pitch",
                "min_players": 1,
                "max_players": 1,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer admin2"},
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]

        # P1 joins
        await ac.post(
            f"/sessions/{session_id}/join",
            headers={"Authorization": "Bearer p1_2"},
        )

        # Admin moves P1 to waitlist
        async with AsyncSession(engine) as db:
            from sqlalchemy import select

            res = await db.execute(
                select(User).where(User.pocket_id_sub == "p1_2-uuid")
            )
            u = res.scalar()
            assert u is not None
            user_id = u.id

        resp = await ac.post(
            f"/sessions/{session_id}/admin/move?user_id={user_id}&new_status=waitlisted",
            headers={"Authorization": "Bearer admin2"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "moved"


@pytest.mark.asyncio
async def test_chat_typing_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await create_test_user(db, "admin", "admin-uuid", is_admin=True)
            await create_test_user(db, "typer", "typer-uuid")
        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": (
                    datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1)
                ).isoformat(),
                "location": "Pitch A",
                "min_players": 1,
                "max_players": 5,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer admin"},
        )
        assert resp.status_code == 201
        sid = resp.json()["id"]
        r2 = await ac.post(
            f"/sessions/{sid}/chat/typing",
            json={"typing": True},
            headers={"Authorization": "Bearer typer"},
        )
        assert r2.status_code == 200
        assert r2.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_patch_session_teams_admin():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await create_test_user(db, "admint", "admint-uuid", is_admin=True)
            await create_test_user(db, "tp1", "tp1-uuid")
            await create_test_user(db, "tp2", "tp2-uuid")
            await create_test_user(db, "tp3", "tp3-uuid")
            await create_test_user(db, "tp4", "tp4-uuid")

        resp = await ac.post(
            "/sessions/",
            json={
                "start_time": (
                    datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1)
                ).isoformat(),
                "location": "Pitch Teams",
                "min_players": 1,
                "max_players": 10,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer admint"},
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]

        for u in ("tp1", "tp2", "tp3", "tp4"):
            rj = await ac.post(
                f"/sessions/{session_id}/join",
                headers={"Authorization": f"Bearer {u}"},
            )
            assert rj.status_code == 200

        async with AsyncSession(engine) as db:
            from sqlalchemy import select

            ids = {}
            for sub in ("tp1-uuid", "tp2-uuid", "tp3-uuid", "tp4-uuid"):
                res = await db.execute(select(User).where(User.pocket_id_sub == sub))
                u = res.scalar()
                assert u is not None
                ids[sub] = str(u.id)

        swap = await ac.patch(
            f"/sessions/{session_id}/teams",
            json={
                "teams": [
                    [ids["tp1-uuid"], ids["tp3-uuid"]],
                    [ids["tp2-uuid"], ids["tp4-uuid"]],
                ]
            },
            headers={"Authorization": "Bearer admint"},
        )
        assert swap.status_code == 200
        body = swap.json()
        assert body["content_revision"] >= 1
        assert len(body["teams"]) == 2
        got = {frozenset(p["id"] for p in t["players"]) for t in body["teams"]}
        assert got == {
            frozenset({ids["tp1-uuid"], ids["tp3-uuid"]}),
            frozenset({ids["tp2-uuid"], ids["tp4-uuid"]}),
        }

        r403 = await ac.patch(
            f"/sessions/{session_id}/teams",
            json={
                "teams": [
                    [ids["tp1-uuid"], ids["tp2-uuid"]],
                    [ids["tp3-uuid"], ids["tp4-uuid"]],
                ]
            },
            headers={"Authorization": "Bearer tp1"},
        )
        assert r403.status_code == 403
