import asyncio
import os
from pathlib import Path

import pytest


# ── Test environment setup ─────────────────────────────────────────────────
_root = Path(__file__).resolve().parents[2]

# Writable SQLite path (must exist before the engine is created on first import).
_db_path = _root / "data" / "pytest_miootz.db"
_db_path.parent.mkdir(parents=True, exist_ok=True)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_path}"

# Separate audit database for tests (same pattern as the main DB above).
os.environ["AUDIT_DATABASE_URL"] = f"sqlite+aiosqlite:///{_root / 'data' / 'pytest_audit.db'}"

# Avoid background scheduler threads during pytest unless explicitly enabled.
os.environ.setdefault("SCHEDULER_ENABLED", "false")


# ── Pocket ID JWT mock ─────────────────────────────────────────────────────
_TOKEN_MAP = {
    "admin": {
        "sub": "admin-uuid",
        "email": "admin@test.com",
        "preferred_username": "admin",
        "name": "Admin",
        "groups": ["admins", "members"],
    },
    "admintoken": {
        "sub": "admin-uuid",
        "email": "admin@test.com",
        "preferred_username": "admin",
        "name": "Admin",
        "groups": ["admins", "members"],
    },
    "user": {
        "sub": "user-uuid",
        "email": "user@test.com",
        "preferred_username": "user",
        "name": "User",
        "groups": ["members"],
    },
    "usertoken": {
        "sub": "user-uuid",
        "email": "user@test.com",
        "preferred_username": "user",
        "name": "User",
        "groups": ["members"],
    },
    "adm": {
        "sub": "adm-uuid",
        "email": "a@test.com",
        "preferred_username": "adm",
        "name": "Adm",
        "groups": ["admins", "members"],
    },
    "admin2": {
        "sub": "admin2-uuid",
        "email": "admin2@test.com",
        "preferred_username": "admin2",
        "name": "Admin2",
        "groups": ["admins", "members"],
    },
    "admint": {
        "sub": "admint-uuid",
        "email": "admint@test.com",
        "preferred_username": "admint",
        "name": "Admint",
        "groups": ["admins", "members"],
    },
    "adminadm": {
        "sub": "adminadm-uuid",
        "email": "adminadm@test.com",
        "preferred_username": "adminadm",
        "name": "AdminAdm",
        "groups": ["admins", "members"],
    },
    "p1": {
        "sub": "p1-uuid",
        "email": "p1@test.com",
        "preferred_username": "p1",
        "name": "P1",
        "groups": ["members"],
    },
    "p2": {
        "sub": "p2-uuid",
        "email": "p2@test.com",
        "preferred_username": "p2",
        "name": "P2",
        "groups": ["members"],
    },
    "p3": {
        "sub": "p3-uuid",
        "email": "p3@test.com",
        "preferred_username": "p3",
        "name": "P3",
        "groups": ["members"],
    },
    "p4": {
        "sub": "p4-uuid",
        "email": "p4@test.com",
        "preferred_username": "p4",
        "name": "P4",
        "groups": ["members"],
    },
    "p5": {
        "sub": "p5-uuid",
        "email": "p5@test.com",
        "preferred_username": "p5",
        "name": "P5",
        "groups": ["members"],
    },
    "p6": {
        "sub": "p6-uuid",
        "email": "p6@test.com",
        "preferred_username": "p6",
        "name": "P6",
        "groups": ["members"],
    },
    "p7": {
        "sub": "p7-uuid",
        "email": "p7@test.com",
        "preferred_username": "p7",
        "name": "P7",
        "groups": ["members"],
    },
    "p8": {
        "sub": "p8-uuid",
        "email": "p8@test.com",
        "preferred_username": "p8",
        "name": "P8",
        "groups": ["members"],
    },
    "p9": {
        "sub": "p9-uuid",
        "email": "p9@test.com",
        "preferred_username": "p9",
        "name": "P9",
        "groups": ["members"],
    },
    "p10": {
        "sub": "p10-uuid",
        "email": "p10@test.com",
        "preferred_username": "p10",
        "name": "P10",
        "groups": ["members"],
    },
    "p11": {
        "sub": "p11-uuid",
        "email": "p11@test.com",
        "preferred_username": "p11",
        "name": "P11",
        "groups": ["members"],
    },
    "p12": {
        "sub": "p12-uuid",
        "email": "p12@test.com",
        "preferred_username": "p12",
        "name": "P12",
        "groups": ["members"],
    },
    "p1_2": {
        "sub": "p1_2-uuid",
        "email": "p1_2@test.com",
        "preferred_username": "p1_2",
        "name": "P1 2",
        "groups": ["members"],
    },
    "tp1": {
        "sub": "tp1-uuid",
        "email": "tp1@test.com",
        "preferred_username": "tp1",
        "name": "TP1",
        "groups": ["members"],
    },
    "tp2": {
        "sub": "tp2-uuid",
        "email": "tp2@test.com",
        "preferred_username": "tp2",
        "name": "TP2",
        "groups": ["members"],
    },
    "tp3": {
        "sub": "tp3-uuid",
        "email": "tp3@test.com",
        "preferred_username": "tp3",
        "name": "TP3",
        "groups": ["members"],
    },
    "tp4": {
        "sub": "tp4-uuid",
        "email": "tp4@test.com",
        "preferred_username": "tp4",
        "name": "TP4",
        "groups": ["members"],
    },
    "typer": {
        "sub": "typer-uuid",
        "email": "typer@test.com",
        "preferred_username": "typer",
        "name": "Typer",
        "groups": ["members"],
    },
    "tester": {
        "sub": "tester-uuid",
        "email": "test@test.com",
        "preferred_username": "tester",
        "name": "Tester",
        "groups": ["members"],
    },
    "testuser": {
        "sub": "testuser-uuid",
        "email": "test@example.com",
        "preferred_username": "testuser",
        "name": "Test User",
        "groups": ["members"],
    },
    "viewer": {
        "sub": "viewer-uuid",
        "email": "viewer@test.com",
        "preferred_username": "viewer",
        "name": "Viewer",
        "groups": ["members"],
    },
    "newusertoken": {
        "sub": "new-sso-user-uuid",
        "email": "newuser@example.com",
        "preferred_username": "new_sso_user",
        "name": "New SSO User",
        "groups": ["members"],
        "signup_token": "test-signup-token",
    },
    "noinvitetoken": {
        "sub": "no-invite-uuid",
        "email": "noinvite@example.com",
        "preferred_username": "no_invite_user",
        "name": "No Invite User",
        "groups": [],
    },
}


async def _default_mock_validate(token: str) -> dict | None:
    """Default mock for Pocket ID JWT validation."""
    if token in _TOKEN_MAP:
        return _TOKEN_MAP[token]
    return None


async def _default_mock_get_user_by_id(user_id: str) -> dict | None:
    """Default mock for Pocket ID get_user_by_id.

    Maps the sub (user_id) back to a synthetic Pocket ID user response
    containing group names and display info.
    """
    # Find the token entry whose sub matches this user_id
    for entry in _TOKEN_MAP.values():
        if entry.get("sub") == user_id:
            groups = entry.get("groups", [])
            return {
                "id": user_id,
                "pocket_id_sub": entry.get("sub", ""),
                "displayName": entry.get("name"),
                "userGroups": [{"id": f"{g}-group-id", "name": g} for g in groups],
            }
    return None


def pytest_configure(config):
    """Patch Pocket ID JWT validation globally before any test collection.

    Test-level monkeypatch.setattr() calls will properly override this.
    """
    import app.services.pocket_id_jwt
    import app.services.pocket_id_client

    app.services.pocket_id_jwt.validate_pocket_id_token = _default_mock_validate
    app.services.pocket_id_client.get_user_by_id = _default_mock_get_user_by_id


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Tests share one process and one in-memory limiter — clear counters.

    Without this, earlier tests hammering rate-limited endpoints would make
    later unrelated tests fail with 429.
    """
    from app.api.rate_limit import limiter

    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture(autouse=True)
async def _finish_sso_syncs():
    """Finish background database writes before another test resets the tables."""
    yield
    from app.api.middleware import _pending_sso_syncs

    await asyncio.gather(*_pending_sso_syncs)
