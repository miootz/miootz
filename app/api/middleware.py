import logging
from typing import Any

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.database import engine
from app.models.user import User

logger = logging.getLogger(__name__)


def _request_behind_trusted_proxy(request: Request) -> bool:
    """Heuristic: Traefik and similar proxies set X-Forwarded-For and/or Forwarded."""
    if request.headers.get("x-forwarded-for"):
        return True
    if request.headers.get("forwarded"):
        return True
    return False


def _parse_groups(raw: str | None) -> list[str]:
    if not raw:
        return []
    parts: list[str] = []
    for chunk in raw.replace(";", ",").split(","):
        g = chunk.strip()
        if g:
            parts.append(g)
    return parts


def _groups_grant_admin(groups: list[str]) -> bool:
    wanted = settings.admin_group_names
    if not wanted:
        return False
    return any(g.lower() in wanted for g in groups)


async def _resolve_user(
    db: AsyncSession, username: str | None, email: str | None
) -> User | None:
    if username:
        result = await db.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
        if user:
            return user
    if email:
        result = await db.execute(
            select(User).where(func.lower(User.email) == email.strip().lower())
        )
        user = result.scalar_one_or_none()
        if user:
            return user
    return None


class AutheliaAuthMiddleware(BaseHTTPMiddleware):
    """
    Trusted Header SSO: identity comes from headers set by Authelia after Traefik forward-auth.

    When AUTH_REQUIRE_FORWARDED_HEADERS is True (recommended behind Traefik in production),
    Remote-User / Remote-Groups are ignored unless the request includes forwarded-proxy headers,
    which prevents trivial spoofing of identity on direct access to uvicorn.
    """

    async def dispatch(self, request: Request, call_next) -> Any:
        request.state.user = None
        request.state.is_admin = False
        request.state.auth_groups = []

        trust_headers = True
        if settings.AUTH_REQUIRE_FORWARDED_HEADERS:
            trust_headers = _request_behind_trusted_proxy(request)
            if not trust_headers:
                logger.debug(
                    "Ignoring identity headers (no forwarded proxy headers): %s",
                    request.url.path,
                )

        username = None
        groups_raw = None
        email = None

        if trust_headers:
            username = request.headers.get(settings.AUTHELIA_USER_HEADER)
            groups_raw = request.headers.get(settings.AUTHELIA_GROUPS_HEADER)
            email = request.headers.get(settings.AUTHELIA_EMAIL_HEADER)

        groups = _parse_groups(groups_raw)
        request.state.auth_groups = groups
        group_admin = _groups_grant_admin(groups)

        user: User | None = None
        if username or email:
            async with AsyncSession(engine) as db:
                user = await _resolve_user(db, username, email)
                if user is None and (username or email):
                    logger.info(
                        "Authenticated proxy user not found in DB (username=%r email=%r)",
                        username,
                        email,
                    )

        request.state.user = user
        request.state.is_admin = bool(
            group_admin or (user.is_admin if user else False)
        )

        return await call_next(request)
