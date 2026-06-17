"""HTTP client for Pocket ID admin API (API key auth)."""

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def _headers() -> dict[str, str]:
    """Build auth headers for Pocket ID admin API.

    Prefers POCKET_ID_STATIC_API_KEY (always valid) over POCKET_ID_API_KEY
    (JWT-based, may become stale after Pocket ID resets).
    """
    key = (
        getattr(settings, "POCKET_ID_STATIC_API_KEY", None)
        or getattr(settings, "POCKET_ID_API_KEY", None)
        or ""
    )
    if not key:
        logger.warning("POCKET_ID_STATIC_API_KEY / POCKET_ID_API_KEY not set — admin API calls will fail")
    return {
        "X-API-Key": key,
        "Content-Type": "application/json",
    }


def _base_url() -> str:
    return settings.POCKET_ID_INTERNAL_URL.rstrip("/")


async def create_signup_token(
    email: str = "",
    ttl: str = "168h",
    usage_limit: int = 1,
    user_group_ids: list[str] | None = None,
) -> dict[str, Any] | None:
    """
    Create a signup token in Pocket ID.

    Args:
        email: Synthetic email for Pocket ID (never shown to user)
        ttl: Time-to-live string (e.g. "168h" for 7 days)
        usage_limit: How many times the token can be used (1 for single-use invites)
        user_group_ids: List of group UUIDs to assign to the new user

    Returns:
        Response dict with keys: token, expiresAt, etc.
    """
    url = f"{_base_url()}/api/signup-tokens"
    body: dict[str, Any] = {
        "ttl": ttl,
        "usageLimit": usage_limit,
    }
    if email:
        body["email"] = email
    if user_group_ids:
        body["userGroupIds"] = user_group_ids

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, headers=_headers(), json=body)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.error("Failed to create signup token: %s", e)
        return None


async def list_signup_tokens() -> list[dict[str, Any]]:
    """
    List all signup tokens from Pocket ID.

    Returns:
        List of token dicts.
    """
    url = f"{_base_url()}/api/signup-tokens"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers=_headers())
            r.raise_for_status()
            data = r.json()
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                return data.get("tokens", data.get("data", []))
            return []
    except Exception as e:
        logger.error("Failed to list signup tokens: %s", e)
        return []


async def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    """
    Fetch a user from Pocket ID by their user ID (UUID).

    Returns the user dict (with username, displayName, userGroups, etc.) or None.
    """
    url = f"{_base_url()}/api/users/{user_id}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers=_headers())
            r.raise_for_status()
            return r.json()
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return None
        logger.error("Failed to fetch user %s from Pocket ID: %s", user_id, e)
        return None
    except Exception as e:
        logger.error("Failed to fetch user %s from Pocket ID: %s", user_id, e)
        return None


async def delete_user(user_id: str) -> bool:
    """
    Delete a user from Pocket ID.

    Args:
        user_id: The Pocket ID user UUID

    Returns:
        True if successful, False otherwise.
    """
    url = f"{_base_url()}/api/users/{user_id}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.delete(url, headers=_headers())
            r.raise_for_status()
            return True
    except Exception as e:
        logger.error("Failed to delete user %s from Pocket ID: %s", user_id, e)
        return False


async def delete_signup_token(token_id: str) -> bool:
    """
    Delete a signup token by its ID.

    Args:
        token_id: The token ID (not the token string itself)

    Returns:
        True if successful, False otherwise.
    """
    url = f"{_base_url()}/api/signup-tokens/{token_id}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.delete(url, headers=_headers())
            r.raise_for_status()
            return True
    except Exception as e:
        logger.error("Failed to delete signup token %s: %s", token_id, e)
        return False
