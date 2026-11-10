import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.main import app
from app.core.database import Base, engine
from app.models.user import User
from app.models.meetup import Attendance, Meetup
from app.models.game_template import GameTemplate
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
async def test_meetup_lifecycle():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Setup Users
        async with AsyncSession(engine) as db:
            await create_test_user(db, "admin", "admin-uuid", is_admin=True)
            await create_test_user(db, "p1", "p1-uuid")
            await create_test_user(db, "p2", "p2-uuid")
            await create_test_user(db, "p3", "p3-uuid")

        # 2. Create Meetup (admin only)
        resp = await ac.post(
            "/meetups/",
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
        meetup_id = resp.json()["id"]

        # 3. Join Meetup (P1) - Confirmed
        resp = await ac.post(
            f"/meetups/{meetup_id}/join",
            headers={"Authorization": "Bearer p1"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"

        # 4. Join Meetup (P2) - Confirmed
        resp = await ac.post(
            f"/meetups/{meetup_id}/join",
            headers={"Authorization": "Bearer p2"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"

        # 5. Join Meetup (P3) - Waitlisted (Capacity 2)
        resp = await ac.post(
            f"/meetups/{meetup_id}/join",
            headers={"Authorization": "Bearer p3"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "waitlisted"

        # 6. P1 Leaves - P3 should be promoted
        resp = await ac.delete(
            f"/meetups/{meetup_id}/leave",
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
            "/meetups/",
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
        meetup_id = resp.json()["id"]

        # P1 joins
        await ac.post(
            f"/meetups/{meetup_id}/join",
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
            f"/meetups/{meetup_id}/admin/move?user_id={user_id}&new_status=waitlisted",
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
            "/meetups/",
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
            f"/meetups/{sid}/chat/typing",
            json={"typing": True},
            headers={"Authorization": "Bearer typer"},
        )
        assert r2.status_code == 200
        assert r2.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_patch_meetup_teams_admin():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await create_test_user(db, "admint", "admint-uuid", is_admin=True)
            await create_test_user(db, "tp1", "tp1-uuid")
            await create_test_user(db, "tp2", "tp2-uuid")
            await create_test_user(db, "tp3", "tp3-uuid")
            await create_test_user(db, "tp4", "tp4-uuid")

        resp = await ac.post(
            "/meetups/",
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
        meetup_id = resp.json()["id"]

        for u in ("tp1", "tp2", "tp3", "tp4"):
            rj = await ac.post(
                f"/meetups/{meetup_id}/join",
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
            f"/meetups/{meetup_id}/teams",
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
            f"/meetups/{meetup_id}/teams",
            json={
                "teams": [
                    [ids["tp1-uuid"], ids["tp2-uuid"]],
                    [ids["tp3-uuid"], ids["tp4-uuid"]],
                ]
            },
            headers={"Authorization": "Bearer tp1"},
        )
        assert r403.status_code == 403


@pytest.mark.asyncio
async def test_skip_meetup_hides_it_from_everywhere():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await create_test_user(db, "admin", "skip-admin", is_admin=True)
            await create_test_user(db, "p1", "skip-p1")

        resp = await ac.post(
            "/meetups/",
            json={
                "start_time": (
                    datetime.now(UTC).replace(tzinfo=None) + timedelta(days=7)
                ).isoformat(),
                "location": "Test Pitch",
                "min_players": 1,
                "max_players": 2,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer admin"},
        )
        assert resp.status_code == 201
        meetup_id = resp.json()["id"]

        # Non-admins cannot skip.
        r = await ac.post(
            f"/meetups/{meetup_id}/skip", headers={"Authorization": "Bearer p1"}
        )
        assert r.status_code == 403

        # Admin skips; the meetup vanishes from every listing and its detail.
        r = await ac.post(
            f"/meetups/{meetup_id}/skip", headers={"Authorization": "Bearer admin"}
        )
        assert r.status_code == 200
        assert r.json()["status"] == "skipped"
        for status in ("all", "upcoming", "past"):
            r = await ac.get(
                "/meetups/",
                params={"status": status},
                headers={"Authorization": "Bearer p1"},
            )
            assert r.status_code == 200
            assert all(m["id"] != meetup_id for m in r.json()["items"])
        r = await ac.get(
            f"/meetups/{meetup_id}", headers={"Authorization": "Bearer p1"}
        )
        assert r.status_code == 404

        # Past meetups cannot be skipped — history is preserved.
        resp = await ac.post(
            "/meetups/",
            json={
                "start_time": (
                    datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
                ).isoformat(),
                "location": "Old Pitch",
                "min_players": 1,
                "max_players": 2,
                "send_push_notifications": False,
            },
            headers={"Authorization": "Bearer admin"},
        )
        assert resp.status_code == 201
        past_id = resp.json()["id"]
        r = await ac.post(
            f"/meetups/{past_id}/skip", headers={"Authorization": "Bearer admin"}
        )
        assert r.status_code == 400

        # Skipping a template meetup pulls the NEXT occurrence forward, so the
        # overview always has a real meetup to manage.
        async with AsyncSession(engine) as db:
            tpl = GameTemplate(
                name="Weekly",
                timezone="UTC",
                weekday=2,
                hour=18,
                minute=0,
                location="Weekly Pitch",
            )
            db.add(tpl)
            await db.commit()
            await db.refresh(tpl)
            tpl_id = tpl.id
            m = await db.get(Meetup, meetup_id)
            m.game_template_id = tpl.id
            await db.commit()

        r = await ac.post(
            f"/meetups/{meetup_id}/skip", headers={"Authorization": "Bearer admin"}
        )
        assert r.status_code == 200
        r = await ac.get(
            "/meetups/",
            params={"status": "upcoming"},
            headers={"Authorization": "Bearer admin"},
        )
        tpl_items = [i for i in r.json()["items"] if i["game_template_id"] == tpl_id]
        assert len(tpl_items) == 1


@pytest.mark.asyncio
async def test_is_current_uses_location_timezone():
    from datetime import timezone as dt_timezone
    from zoneinfo import ZoneInfo

    tz = ZoneInfo("Pacific/Kiritimati")  # UTC+14
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSession(engine) as db:
            await create_test_user(db, "admin", "tz-admin", is_admin=True)
            tpl = GameTemplate(
                name="TZ",
                timezone="Pacific/Kiritimati",
                weekday=1,
                hour=12,
                minute=0,
                location="Island Pitch",
            )
            db.add(tpl)
            await db.commit()
            await db.refresh(tpl)

            # Today 00:01 in the location tz — yesterday in UTC, so the old
            # UTC-midnight rule would not have flagged it as current.
            start_today = (
                datetime.now(dt_timezone.utc)
                .astimezone(tz)
                .replace(hour=0, minute=1, second=0, microsecond=0)
                .astimezone(dt_timezone.utc)
                .replace(tzinfo=None)
            )
            m_today = Meetup(
                start_time=start_today, location="Island Pitch", game_template_id=tpl.id
            )
            db.add(m_today)

            # Yesterday 12:00 in the location tz — its day is over.
            start_yest = (
                (datetime.now(dt_timezone.utc).astimezone(tz) - timedelta(days=1))
                .replace(hour=12, minute=0, second=0, microsecond=0)
                .astimezone(dt_timezone.utc)
                .replace(tzinfo=None)
            )
            m_yest = Meetup(
                start_time=start_yest, location="Island Pitch", game_template_id=tpl.id
            )
            db.add(m_yest)
            await db.commit()
            await db.refresh(m_today)
            await db.refresh(m_yest)

        r = await ac.get(
            "/meetups/", params={"status": "all"},
            headers={"Authorization": "Bearer admin"},
        )
        assert r.status_code == 200
        by_id = {item["id"]: item for item in r.json()["items"]}
        assert by_id[m_today.id]["is_current"] is True
        assert by_id[m_yest.id]["is_current"] is False
