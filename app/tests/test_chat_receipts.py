import json
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.core.timeutil import utcnow
from app.models.chat import ChatMessage, ChatReceipt
from app.models.job_queue import JobQueue
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.models.user_notification_preference import UserNotificationPreference
from app.models.web_push_subscription import WebPushSubscription
from app.services import web_push
from app.services.job_queue import run_due_jobs


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSession(engine) as db:
        db.add_all([
            User(id=1, pocket_id_sub="admin-uuid", sso_display_name="Admin", is_admin=True),
            User(id=2, pocket_id_sub="p1-uuid", sso_display_name="P1"),
            User(id=3, pocket_id_sub="p2-uuid", sso_display_name="P2"),
            User(id=4, pocket_id_sub="p3-uuid", sso_display_name="P3"),
            User(id=5, pocket_id_sub="p4-uuid", sso_display_name="P4"),
            User(id=6, pocket_id_sub="p5-uuid", sso_display_name="P5"),
            Meetup(id=1, start_time=datetime(2026, 1, 1), location="Pitch"),
            Meetup(id=2, start_time=datetime(2026, 1, 2), location="Pitch"),
        ])
        await db.flush()
        db.add_all(
            Attendance(meetup_id=1, user_id=uid, status="confirmed", joined_at=utcnow() - timedelta(hours=1))
            for uid in range(1, 7)
        )
        await db.commit()
    yield


def headers(token):
    return {"Authorization": f"Bearer {token}"}


async def test_receipts_are_monotonic_private_and_scoped(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr("app.api.meetups.chat_manager.broadcast", broadcast)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = await client.post("/meetups/1/chat", headers=headers("admin"), json={"message": "One"})
        second = await client.post("/meetups/1/chat", headers=headers("admin"), json={"message": "Two"})
        foreign = await client.post("/meetups/2/chat", headers=headers("admin"), json={"message": "Other"})
        first_id = first.json()["message_id"]
        second_id = second.json()["message_id"]
        foreign_id = foreign.json()["message_id"]

        receipt = await client.post("/meetups/1/chat/receipt", headers=headers("p1"), json={"delivered_id": second_id})
        assert receipt.status_code == 200
        own = (await client.get("/meetups/1/chat/receipts", headers=headers("admin"))).json()
        assert own == {
            str(first_id): {"delivered": 1, "read": 0},
            str(second_id): {"delivered": 1, "read": 0},
        }
        assert (await client.get("/meetups/1/chat/receipts", headers=headers("p1"))).json() == {}

        read = await client.post("/meetups/1/chat/receipt", headers=headers("p1"), json={"delivered_id": second_id, "read_id": second_id})
        assert read.status_code == 200
        again = await client.post("/meetups/1/chat/receipt", headers=headers("p1"), json={"delivered_id": first_id})
        assert again.status_code == 200
        own = (await client.get("/meetups/1/chat/receipts", headers=headers("admin"))).json()
        assert own[str(second_id)] == {"delivered": 1, "read": 1}
        assert (await client.post("/meetups/1/chat/receipt", headers=headers("p2"), json={"delivered_id": foreign_id})).status_code == 404
        assert (await client.post("/meetups/1/chat/receipt", headers=headers("p2"), json={"delivered_id": first_id, "read_id": second_id})).status_code == 400
        assert sum(call.args[1].get("type") == "receipt" for call in broadcast.await_args_list) == 2

    async with AsyncSession(engine) as db:
        saved = await db.get(ChatReceipt, (1, 2))
        assert (saved.delivered_id, saved.read_id) == (second_id, second_id)
        assert (await db.scalar(select(JobQueue).where(JobQueue.ref_id == second_id))).job_type == "chat_notification"


async def test_push_waits_for_receipt_and_respects_preference(monkeypatch):
    monkeypatch.setattr(web_push.settings, "VAPID_PRIVATE_KEY", "private")
    monkeypatch.setattr(web_push.settings, "VAPID_PUBLIC_KEY", "public")
    sent = []
    monkeypatch.setattr(web_push, "_send_one", lambda sub, data: sent.append((sub.user_id, json.loads(data))))
    async with AsyncSession(engine) as db:
        db.add_all([
            WebPushSubscription(user_id=uid, endpoint=f"https://example.com/{uid}", p256dh="key", auth="auth")
            for uid in range(1, 7)
        ])
        db.add(UserNotificationPreference(user_id=4, category="chat", enabled=False))
        await db.execute(update(Attendance).where(Attendance.user_id == 3).values(status="waitlisted"))
        await db.execute(update(Attendance).where(Attendance.user_id == 5).values(status="cancelled"))
        await db.execute(delete(Attendance).where(Attendance.user_id == 6))
        await db.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/meetups/1/chat", headers=headers("admin"), json={"message": "Hello"})
        message_id = response.json()["message_id"]
        read = await client.post("/meetups/1/chat/receipt", headers=headers("p1"), json={"delivered_id": message_id, "read_id": message_id})
        assert read.status_code == 200
        delivered = await client.post("/meetups/1/chat/receipt", headers=headers("p2"), json={"delivered_id": message_id})
        assert delivered.status_code == 200
        history = await client.get("/meetups/1/chat", headers=headers("p5"))
        assert history.status_code == 200 and history.json()[-1]["id"] == message_id
        assert sent == []

    async with AsyncSession(engine) as db:
        await db.execute(update(JobQueue).where(JobQueue.job_type == "chat_notification").values(run_at=utcnow() - timedelta(seconds=1)))
        await db.commit()
    assert await run_due_jobs() == 1
    assert {uid for uid, _ in sent} == {3, 5}
    payload = sent[0][1]
    assert payload["message_id"] == message_id
    assert payload["tag"] == "meetup-chat-1"
    assert payload["url"] == "/meetups/1/chat"
    assert "Hello" in payload["body"]


async def test_deletion_cleans_receipts_and_pending_chat_jobs():
    from app.services.deletes import delete_meetup_children, delete_user_children

    async with AsyncSession(engine) as db:
        message = ChatMessage(meetup_id=1, user_id=2, message="Hello")
        db.add(message)
        await db.flush()
        db.add_all([
            ChatReceipt(meetup_id=1, user_id=2, delivered_id=message.id, read_id=message.id),
            JobQueue(job_type="chat_notification", ref_id=message.id, run_at=utcnow(), created_at=utcnow()),
        ])
        await db.commit()
        await delete_user_children(db, 2)
        await db.delete(await db.get(User, 2))
        await db.commit()
        assert await db.scalar(select(ChatReceipt)) is None
        assert await db.scalar(select(JobQueue)) is None

        db.add(ChatReceipt(meetup_id=1, user_id=3, delivered_id=1, read_id=0))
        await db.commit()
        await delete_meetup_children(db, 1)
        await db.delete(await db.get(Meetup, 1))
        await db.commit()
        assert await db.scalar(select(ChatReceipt)) is None
