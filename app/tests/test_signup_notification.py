from datetime import datetime
import json
from unittest.mock import AsyncMock

import pytest

from app.models.meetup import Meetup
from app.models.user import User
from app.services import web_push


@pytest.mark.asyncio
async def test_signup_notification_body_and_join_action_open_join_flow(monkeypatch):
    monkeypatch.setattr(web_push.settings, "VAPID_PRIVATE_KEY", "test-private")
    monkeypatch.setattr(web_push.settings, "VAPID_PUBLIC_KEY", "test-public")
    monkeypatch.setattr(web_push.settings, "PUBLIC_APP_URL", "https://example.test")
    send = AsyncMock()
    monkeypatch.setattr(web_push, "_send_push_to_users", send)
    meetup = Meetup(
        id=42, start_time=datetime(2026, 9, 14, 16, 30), location="Pitch 2", fee=5
    )
    db = AsyncMock()

    await web_push.notify_new_meetup_invites(db, meetup, [User(id=19)])

    send.assert_awaited_once()
    args = send.await_args
    assert args is not None
    assert args.args[:2] == (db, {19})
    assert args.kwargs["category"] == "meetup_invite"
    payload = json.loads(args.args[2])
    # iOS can omit notification action buttons, so the default tap must join too.
    assert payload["url"] == "/meetup-action?mid=42&act=join"
    actions = {action["action"]: action["url"] for action in payload["actions"]}
    assert actions["join"] == "https://example.test/meetup-action?mid=42&act=join"
    assert actions["ignore"] == "https://example.test/meetup-action?mid=42&act=ignore"
