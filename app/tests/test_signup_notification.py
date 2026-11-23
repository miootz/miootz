from datetime import timedelta
import json
from unittest.mock import AsyncMock

import pytest
from py_vapid import Vapid

from app.core.timeutil import utcnow
from app.models.meetup import Meetup
from app.models.user import User
from app.services import web_push
from app.services.meetup_signup import read_signup_hold_token


@pytest.mark.asyncio
async def test_signup_notification_body_and_join_action_open_join_flow(monkeypatch, tmp_path):
    vapid = Vapid()
    vapid.generate_keys()
    key_path = tmp_path / "vapid-private.pem"
    vapid.save_key(str(key_path))
    monkeypatch.setattr(web_push.settings, "VAPID_PRIVATE_KEY", str(key_path))
    monkeypatch.setattr(web_push.settings, "VAPID_PUBLIC_KEY", "test-public")
    monkeypatch.setattr(web_push.settings, "PUBLIC_APP_URL", "https://example.test")
    send = AsyncMock()
    monkeypatch.setattr(web_push, "_send_push_to_users", send)
    meetup = Meetup(
        id=42, start_time=utcnow() + timedelta(days=1), location="Pitch 2", fee=5
    )
    db = AsyncMock()

    await web_push.notify_new_meetup_invites(db, meetup, [User(id=19)])

    send.assert_awaited_once()
    args = send.await_args
    assert args is not None
    assert args.args[:2] == (db, {19})
    assert args.kwargs["category"] == "meetup_invite"
    make_payload = args.args[2]
    payload = json.loads(make_payload(19))
    # iOS can omit notification action buttons, so the default tap must join too.
    assert payload["url"].startswith("/meetup-reservation#hold=")
    token = payload["url"].split("#hold=")[1]
    assert read_signup_hold_token(token, utcnow()) == (42, 19)
    assert read_signup_hold_token(token.replace("42.19.", "42.20."), utcnow()) is None
    assert json.loads(make_payload(20))["url"] != payload["url"]
    actions = {action["action"]: action["url"] for action in payload["actions"]}
    assert actions["join"] == f"https://example.test{payload['url']}"
    assert actions["ignore"] == "https://example.test/meetup-action?mid=42&act=ignore"
