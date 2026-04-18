"""Server-side Authelia first-factor login (used after invite password setup)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


async def authelia_first_factor_login(
    *,
    internal_base_url: str,
    username: str,
    password: str,
    target_url: str,
) -> tuple[list[str], str | None]:
    """
    POST to Authelia ``/api/firstfactor`` from inside the Docker network.

    Returns ``(set_cookie_raw_values, redirect_url)`` where each cookie value is a full
    ``Set-Cookie`` header value (without the ``Set-Cookie:`` prefix). ``redirect_url`` is
    parsed from Authelia's JSON body when present.
    """
    base = internal_base_url.rstrip("/")
    url = f"{base}/api/firstfactor"
    payload: dict[str, Any] = {
        "username": username,
        "password": password,
        "keepMeLoggedIn": False,
        "targetURL": target_url,
    }
    async with httpx.AsyncClient(timeout=25.0) as client:
        try:
            r = await client.post(url, json=payload)
        except httpx.RequestError as e:
            logger.exception("Authelia firstfactor request failed: %s", e)
            raise RuntimeError("Could not reach Authelia to complete sign-in.") from e

    raw_cookies: list[str] = []
    for k, v in r.headers.multi_items():
        if k.lower() == "set-cookie":
            raw_cookies.append(v)

    body: dict[str, Any] = {}
    try:
        if r.content:
            parsed = r.json()
            if isinstance(parsed, dict):
                body = parsed
    except Exception:
        pass

    if r.status_code != 200:
        logger.warning(
            "Authelia firstfactor HTTP %s body=%s",
            r.status_code,
            (r.text or "")[:500],
        )
        raise RuntimeError("Authelia rejected sign-in after password setup.")

    if body.get("status") == "KO":
        msg = body.get("message") or "Authentication failed"
        logger.warning("Authelia firstfactor KO: %s", msg)
        raise RuntimeError("Authelia rejected sign-in after password setup.")

    redirect: str | None = None
    if body.get("status") == "OK" and isinstance(body.get("data"), dict):
        redirect = body["data"].get("redirect")

    return raw_cookies, redirect
