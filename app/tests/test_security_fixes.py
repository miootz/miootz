"""Regression tests for the 2026-11-12 security-audit fixes.

- goal log requires auth (no longer public)
- join/leave are admin-only after meetup start
- attending (present) members get match CRUD, not just admins
- push subscriptions: ownership + endpoint host allowlist
- report-score: players may only score confirmed attendees
- Pocket ID iss/aud config fails fast at startup
"""

from datetime import datetime, timedelta, UTC
from types import SimpleNamespace
import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.config import settings
from app.core.database import Base, engine
from app.models.match import MeetupMatch
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.models.web_push_subscription import WebPushSubscription
from app.services.pocket_id_jwt import assert_oidc_config
from app.services import web_push


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def seed_user(token: str, admin: bool = False) -> int:
    """DB user pre-linked to a conftest token (JIT would do the same)."""
    async with AsyncSession(engine) as db:
        u = User(pocket_id_sub=f"{token}-uuid")
        u.is_admin = admin
        db.add(u)
        await db.flush()
        uid = u.id
        await db.commit()
        return uid


async def seed_meetup_and_match(
    start: datetime, *, status: str = "pending"
) -> tuple[int, int]:
    """Returns (meetup_id, match_id) — ids read before the session closes."""
    async with AsyncSession(engine) as db:
        mup = Meetup(start_time=start, location="Pitch")
        db.add(mup)
        await db.flush()
        sid = mup.id
        db.add(
            MeetupMatch(
                meetup_id=mup.id,
                match_number=1,
                team_a_users="[]",
                team_b_users="[]",
                team_a_name="A",
                team_b_name="B",
                score_a=0,
                score_b=0,
                status=status,
                timer_total_seconds=600,
            )
        )
        await db.commit()
        return sid, 1


async def seed_meetup(start: datetime) -> int:
    async with AsyncSession(engine) as db:
        mup = Meetup(start_time=start, location="Pitch")
        db.add(mup)
        await db.flush()
        sid = mup.id
        await db.commit()
        return sid


async def seed_attendance(meetup_id: int, user_id: int) -> None:
    async with AsyncSession(engine) as db:
        db.add(Attendance(meetup_id=meetup_id, user_id=user_id, status="confirmed"))
        await db.commit()


# ── Goal log: authenticated, not public ─────────────────────────────


@pytest.mark.asyncio
async def test_goal_log_requires_auth():
    sid, mid = await seed_meetup_and_match(utc_naive())
    async with await client() as ac:
        url = f"/meetups/{sid}/matches/{mid}/goals"
        assert (await ac.get(url)).status_code == 401
        assert (await ac.get(url, headers=hdr("viewer"))).status_code == 200


# ── Join/leave: admin-only after start ──────────────────────────────


@pytest.mark.asyncio
async def test_join_leave_after_start_admin_only():
    # Meetup starts in an hour; p1 joins pre-start, then time passes.
    sid = await seed_meetup(utc_naive() + timedelta(hours=1))
    await seed_user("p1")
    admin_id = await seed_user("admin", admin=True)
    await seed_attendance(sid, admin_id)
    async with await client() as ac:
        assert (await ac.post(f"/meetups/{sid}/join", headers=hdr("p1"))).status_code == 200
    async with AsyncSession(engine) as db:
        await db.execute(
            update(Meetup).where(Meetup.id == sid).values(
                start_time=utc_naive() - timedelta(minutes=5)
            )
        )
        await db.commit()
    async with await client() as ac:
        r = await ac.delete(f"/meetups/{sid}/leave", headers=hdr("p1"))
        assert r.status_code == 403, r.text
        assert "admin" in r.json()["detail"]
        # Admins keep attendance control at all times.
        r = await ac.delete(f"/meetups/{sid}/leave", headers=hdr("admin"))
        assert r.status_code == 200, r.text


# ── Attending members get match CRUD ────────────────────────────────


@pytest.mark.asyncio
async def test_present_member_can_score():
    sid, mid = await seed_meetup_and_match(
        utc_naive() - timedelta(minutes=15), status="active"
    )
    p1 = await seed_user("p1")
    await seed_attendance(sid, p1)
    async with await client() as ac:
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/score",
            json={"team": "a", "delta": 1},
            headers=hdr("p1"),
        )
        assert r.status_code == 200, r.text
        assert r.json()["score_a"] == 1
        # Non-attending player is still 403.
        r = await ac.post(
            f"/meetups/{sid}/matches/{mid}/score",
            json={"team": "a", "delta": 1},
            headers=hdr("viewer"),
        )
        assert r.status_code == 403


# ── Push subscriptions: ownership + host allowlist ──────────────────


@pytest.mark.asyncio
async def test_push_subscription_ownership_and_allowlist(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY", "pub")
    monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY", "pri")
    async with await client() as ac:
        for host in ("evil.example.com", "push.apple.com.example.com", "fakepush.apple.com"):
            r = await ac.post(
                "/users/me/push/subscription",
                json={"endpoint": f"https://{host}/x", "keys": {"p256dh": "k", "auth": "a"}},
                headers=hdr("p1"),
            )
            assert r.status_code == 400, r.text
        for host in ("web.push.apple.com", "updates.push.services.mozilla.com", "push.services.mozilla.com"):
            r = await ac.post(
                "/users/me/push/subscription",
                json={"endpoint": f"https://{host}/x", "keys": {"p256dh": "k", "auth": "a"}},
                headers=hdr("p1"),
            )
            assert r.status_code == 200, r.text
        # Allowed host: p1 registers, p2 cannot steal it.
        body = {
            "endpoint": "https://fcm.googleapis.com/fcm/send/dev1",
            "keys": {"p256dh": "k", "auth": "a"},
        }
        assert (await ac.post("/users/me/push/subscription", json=body, headers=hdr("p1"))).status_code == 200
        r = await ac.post("/users/me/push/subscription", json=body, headers=hdr("p2"))
        assert r.status_code == 409, r.text
        # p1 re-registering their own endpoint still works (key rotation).
        assert (await ac.post("/users/me/push/subscription", json=body, headers=hdr("p1"))).status_code == 200


# ── report-score: players score only confirmed attendees ────────────


async def test_push_diagnostic_sends_only_to_calling_admin_and_reports_failures(monkeypatch):
    admin_id = await seed_user("admin", admin=True)
    member_id = await seed_user("p1")
    calls = []

    def mock_send(sub, data):
        calls.append((sub.user_id, json.loads(data)))
        if sub.endpoint.endswith("/expired"):
            raise web_push.WebPushException("gone", response=SimpleNamespace(status_code=410))
        if sub.endpoint.endswith("/reject"):
            raise web_push.WebPushException("rejected", response=SimpleNamespace(status_code=403))

    monkeypatch.setattr(web_push, "_send_one", mock_send)
    async with await client() as ac:
        url = "/users/me/push/test"
        assert (await ac.post(url, headers=hdr("p1"))).status_code == 403
        monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY", "")
        assert (await ac.post(url, headers=hdr("admin"))).status_code == 503
        monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY", "pub")
        monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY", "pri")
        response = await ac.post(url, headers=hdr("admin"))
        assert response.json() == {"sent": 0, "failed": 0, "expired": 0}

        async with AsyncSession(engine) as db:
            db.add_all(
                WebPushSubscription(
                    user_id=uid, endpoint=f"https://fcm.googleapis.com/{suffix}",
                    p256dh="test-key", auth="test-auth",
                )
                for uid, suffix in (
                    (admin_id, "ok"), (admin_id, "expired"), (admin_id, "reject"), (member_id, "other"),
                )
            )
            await db.commit()

        response = await ac.post(url, headers=hdr("admin"))
        assert response.json() == {"sent": 1, "failed": 1, "expired": 1}
        assert len(calls) == 3
        assert all(uid == admin_id and payload["url"] == "/admin/tools" for uid, payload in calls)
        devices = await ac.get("/users/me/push/subscriptions", headers=hdr("admin"))
        assert len(devices.json()["items"]) == 2


@pytest.mark.asyncio
async def test_report_score_requires_attendee():
    sid = await seed_meetup(utc_naive() - timedelta(hours=1))
    p1 = await seed_user("p1")
    p2 = await seed_user("p2")
    await seed_attendance(sid, p1)
    async with await client() as ac:
        # p1 (confirmed) scoring p2 (never attended): refused.
        r = await ac.post(
            "/users/report-score",
            json={"meetup_id": sid, "player_id": p2, "score": 4, "type": "team"},
            headers=hdr("p1"),
        )
        assert r.status_code == 403, r.text
        # p1 scoring themselves: allowed.
        r = await ac.post(
            "/users/report-score",
            json={"meetup_id": sid, "player_id": p1, "score": 4, "type": "team"},
            headers=hdr("p1"),
        )
        assert r.status_code == 200, r.text


# ── Pocket ID config fail-fast ──────────────────────────────────────


def test_oidc_config_fail_fast(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "POCKET_ID_INTERNAL_URL", "http://pocket-id:1411")
    monkeypatch.setattr(settings, "POCKET_ID_OIDC_ISSUER", "")
    monkeypatch.setattr(settings, "POCKET_ID_OIDC_CLIENT_ID", "miootz-app")
    with pytest.raises(RuntimeError, match="POCKET_ID_OIDC_ISSUER"):
        assert_oidc_config()

    monkeypatch.setattr(settings, "POCKET_ID_OIDC_ISSUER", "https://auth.example.com")
    assert assert_oidc_config() is None

    monkeypatch.setattr(settings, "POCKET_ID_INTERNAL_URL", "")
    monkeypatch.setattr(settings, "POCKET_ID_OIDC_ISSUER", "")
    assert assert_oidc_config() is None  # no Pocket ID at all (demo)


def utc_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
