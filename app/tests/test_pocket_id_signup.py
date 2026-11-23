import json
from functools import partial

import httpx
import pytest

from app.services import pocket_id_client


@pytest.fixture(autouse=True)
def mock_pocket_id_settings(monkeypatch):
    monkeypatch.setattr(pocket_id_client.settings, "POCKET_ID_INTERNAL_URL", "https://pocket-id.test")
    monkeypatch.setattr(pocket_id_client.settings, "POCKET_ID_STATIC_API_KEY", "test-key")


@pytest.mark.parametrize("assigned_group", [True, False])
async def test_create_signup_token_verifies_discovered_members_group(monkeypatch, assigned_group):
    requested_paths = []

    def pocket_id(request):
        requested_paths.append(request.url.path)
        if request.url.path == "/api/user-groups":
            assert request.url.params["search"] == "members"
            return httpx.Response(200, json={"data": [{"name": "members", "id": "members-id"}]})
        assert request.url.path == "/api/signup-tokens"
        assert json.loads(request.content) == {
            "ttl": "168h", "usageLimit": 1, "userGroupIds": ["members-id"],
        }
        groups = [{"id": "members-id"}] if assigned_group else []
        return httpx.Response(201, json={"token": "signup-token", "userGroups": groups})

    monkeypatch.setattr(pocket_id_client.settings, "POCKET_ID_MEMBERS_GROUP_ID", "")
    monkeypatch.setattr(httpx, "AsyncClient", partial(httpx.AsyncClient, transport=httpx.MockTransport(pocket_id)))
    invite = await pocket_id_client.create_signup_token()
    assert requested_paths == ["/api/user-groups", "/api/signup-tokens"]
    assert bool(invite) is assigned_group


async def test_redeemed_signup_token_uses_exact_subject_and_event(monkeypatch):
    def pocket_id(request):
        assert request.url.path == "/api/audit-logs/all"
        assert request.url.params["filters[userID]"] == "invitee-id"
        assert request.url.params["filters[event]"] == "ACCOUNT_CREATED"
        return httpx.Response(200, json={"data": [
            {"event": "ACCOUNT_CREATED", "userID": "other-id", "data": {"signupToken": "other-token"}},
            {"event": "SIGN_IN", "userID": "invitee-id", "data": {"signupToken": "wrong-event"}},
            {"event": "ACCOUNT_CREATED", "userID": "invitee-id", "data": {"signupToken": "correct-token"}},
        ]})

    monkeypatch.setattr(httpx, "AsyncClient", partial(httpx.AsyncClient, transport=httpx.MockTransport(pocket_id)))
    assert await pocket_id_client.get_redeemed_signup_token("invitee-id") == "correct-token"
