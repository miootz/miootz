import asyncio
import threading

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.database import Base
from app.models.user import User
from app.models.user_notification_preference import UserNotificationPreference
from app.models.web_push_subscription import WebPushSubscription
from app.services import web_push


@pytest.fixture
async def push_engine(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'push.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


def subscription(user_id: int, endpoint: str) -> WebPushSubscription:
    return WebPushSubscription(
        user_id=user_id, endpoint=endpoint, p256dh="key", auth="auth"
    )


async def test_push_fetches_subscriptions_once_and_respects_preferences(
    push_engine, monkeypatch
):
    async with AsyncSession(push_engine, expire_on_commit=False) as db:
        db.add_all(User(id=uid) for uid in range(1, 6))
        db.add_all(
            [
                subscription(1, "default-1"),
                subscription(1, "default-2"),
                subscription(2, "enabled"),
                subscription(3, "opted-out"),
                subscription(4, "other-category"),
                subscription(5, "not-recipient"),
                UserNotificationPreference(user_id=2, category="chat", enabled=True),
                UserNotificationPreference(user_id=3, category="chat", enabled=False),
                UserNotificationPreference(user_id=4, category="waitlist", enabled=False),
            ]
        )
        await db.commit()

        sent = []
        monkeypatch.setattr(web_push, "_send_one", lambda sub, data: sent.append(sub.endpoint))
        queries = []

        def count_selects(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                queries.append(statement)

        event.listen(push_engine.sync_engine, "before_cursor_execute", count_selects)
        try:
            counts = await web_push._send_push_to_users(db, {1, 2, 3, 4}, "payload", "chat")
            assert counts == {"sent": 4, "failed": 0, "expired": 0}
            assert set(sent) == {"default-1", "default-2", "enabled", "other-category"}
            assert len(queries) == 1

            sent.clear()
            queries.clear()
            counts = await web_push._send_push_to_users(db, {1, 2, 3, 4}, "payload")
            assert counts == {"sent": 5, "failed": 0, "expired": 0}
            assert set(sent) == {
                "default-1", "default-2", "enabled", "opted-out", "other-category"
            }
            assert len(queries) == 1

            queries.clear()
            assert await web_push._send_push_to_users(db, set(), "payload", "chat") == {
                "sent": 0, "failed": 0, "expired": 0
            }
            assert not queries
        finally:
            event.remove(push_engine.sync_engine, "before_cursor_execute", count_selects)


async def test_push_concurrency_is_bounded_across_calls(push_engine, monkeypatch):
    limit = web_push._MAX_CONCURRENT_PUSH_SENDS
    async with AsyncSession(push_engine) as db:
        db.add_all([User(id=1), User(id=2)])
        db.add_all(
            subscription(uid, f"{uid}-{index}")
            for uid in (1, 2)
            for index in range(limit + 2)
        )
        await db.commit()

    lock = threading.Lock()
    saturated = threading.Event()
    release = threading.Event()
    active = 0
    maximum = 0

    def send(sub, data):
        nonlocal active, maximum
        with lock:
            active += 1
            maximum = max(maximum, active)
            if active == limit:
                saturated.set()
        try:
            release.wait(timeout=5)
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr(web_push, "_send_one", send)

    async def send_to(uid):
        async with AsyncSession(push_engine) as db:
            return await web_push._send_push_to_users(db, {uid}, "payload")

    tasks = [asyncio.create_task(send_to(uid)) for uid in (1, 2)]
    try:
        reached_limit = await asyncio.to_thread(saturated.wait, 5)
    finally:
        release.set()
        results = await asyncio.gather(*tasks)

    assert reached_limit
    assert maximum == limit
    assert results == [{"sent": limit + 2, "failed": 0, "expired": 0}] * 2
