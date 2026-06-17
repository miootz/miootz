import asyncio
import logging
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.config import settings
from app.core.database import async_session, engine
from app.models.invite import InviteToken
from app.models.user import User
from app.services.pocket_id_jwt import validate_pocket_id_token, extract_user_claims
from app.services.pocket_id_client import get_user_by_id

logger = logging.getLogger(__name__)


async def _sync_sso_data(user: User, pocket_id_sub: str) -> None:
    """Sync SSO data from Pocket ID admin API into the local DB.

    Called synchronously on JIT provisioning and as a background refresh
    on subsequent auth.
    """
    try:
        async with async_session() as db:
            sso_user = await get_user_by_id(pocket_id_sub)
            if sso_user is None:
                return
            user_groups = sso_user.get("userGroups", [])
            group_names = [
                g.get("name")
                for g in user_groups
                if isinstance(g, dict)
            ]
            display_name = sso_user.get("displayName")
            preferred_username = sso_user.get("preferredUsername") or sso_user.get("username")
            # Re-fetch the user row to avoid stale-state writes
            fresh = await db.get(User, user.id)
            if fresh is None:
                return
            if (
                fresh.sso_display_name != display_name
                or fresh.sso_preferred_username != preferred_username
                or fresh.sso_groups != group_names
            ):
                fresh.sso_display_name = display_name
                fresh.sso_preferred_username = preferred_username
                fresh.sso_groups = group_names
                await db.commit()
    except Exception:
        logger.exception("SSO sync failed for sub=%s", pocket_id_sub)


def _background_sync_sso(user: User, pocket_id_sub: str) -> None:
    """Fire-and-forget background SSO refresh (for existing users)."""
    asyncio.create_task(_sync_sso_data(user, pocket_id_sub))


async def _resolve_user_by_pocket_id_sub(
    db: AsyncSession, pocket_id_sub: str
) -> User | None:
    """Look up user by Pocket ID sub claim."""
    result = await db.execute(
        select(User).where(User.pocket_id_sub == pocket_id_sub)
    )
    return result.scalar_one_or_none()


async def _link_existing_user_via_invite(
    db: AsyncSession, claims: dict
) -> User | None:
    """Try to link a Pocket ID account to an existing miootz user via invite token.

    Checks the JWT for a signup_token claim, then falls back to querying
    Pocket ID's admin API. If a matching InviteToken with user_id is found,
    links the existing User row and returns it.
    """
    pocket_id_sub = claims.get("sub", "")

    # Strategy 1: JWT contains signup_token claim
    signup_token = claims.get("signup_token")

    # Strategy 2: Query Pocket ID admin API for signup token
    if not signup_token:
        try:
            sso_user = await get_user_by_id(pocket_id_sub)
            if sso_user:
                signup_token = sso_user.get("signupToken") or sso_user.get("signup_token")
        except Exception:
            logger.debug("Could not fetch Pocket ID user for invite linking (sub=%r)", pocket_id_sub)

    if not signup_token:
        return None

    # Look up the invite token
    result = await db.execute(
        select(InviteToken).where(InviteToken.token == signup_token)
    )
    invite = result.scalar_one_or_none()
    if not invite or not invite.user_id:
        return None

    # Link to existing user
    existing_user = await db.get(User, invite.user_id)
    if not existing_user or existing_user.pocket_id_sub:
        return None

    existing_user.pocket_id_sub = pocket_id_sub
    invite.used = True

    # Sync SSO data
    try:
        sso_user = await get_user_by_id(pocket_id_sub)
        if sso_user:
            user_groups = sso_user.get("userGroups", [])
            groups = [
                g.get("name")
                for g in user_groups
                if isinstance(g, dict)
            ]
            existing_user.sso_display_name = sso_user.get("displayName") or existing_user.sso_display_name
            existing_user.sso_preferred_username = (
                sso_user.get("preferredUsername")
                or sso_user.get("username")
                or existing_user.sso_preferred_username
            )
            existing_user.sso_groups = groups if groups else None
    except Exception:
        logger.exception("SSO sync failed during invite linking for sub=%s", pocket_id_sub)

    logger.info(
        "Linked existing user (id=%d) to Pocket ID (sub=%r) via invite token %r",
        existing_user.id,
        pocket_id_sub,
        signup_token,
    )
    return existing_user


async def _jit_provision_user(db: AsyncSession, claims: dict) -> User:
    """Create a DB user from Pocket ID JWT claims.

    Group-gated: the user must be in at least one Pocket ID group (e.g. 'members').
    Groups are fetched from the Pocket ID admin API (not from the JWT,
    which may not include the groups claim).
    """
    pocket_id_sub = claims.get("sub", "")

    # Fetch SSO data from Pocket ID admin API (synchronous on first auth)
    sso_user = await get_user_by_id(pocket_id_sub)
    display_name: str | None = None
    preferred_username: str | None = None
    groups: list[str] = []
    if sso_user is not None:
        user_groups = sso_user.get("userGroups", [])
        groups = [
            g.get("name")
            for g in user_groups
            if isinstance(g, dict)
        ]
        display_name = sso_user.get("displayName")
        preferred_username = sso_user.get("preferredUsername") or sso_user.get("username")

    # Gate: user must belong to at least one group
    if not groups:
        logger.warning(
            "JIT provisioning rejected: user has no Pocket ID groups (sub=%r)",
            pocket_id_sub,
        )
        raise ValueError(
            "Your Pocket ID account is not a member of any group. "
            "Contact an admin to be added."
        )

    # Create user
    user = User(
        pocket_id_sub=pocket_id_sub,
        sso_display_name=display_name,
        sso_preferred_username=preferred_username,
        sso_groups=groups if groups else None,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    logger.info(
        "JIT provisioned user from Pocket ID token (sub=%r, display_name=%r, groups=%r)",
        pocket_id_sub,
        display_name,
        groups,
    )
    return user


async def _resolve_or_create_user(db: AsyncSession, claims: dict) -> User:
    """Resolve an existing user or create/link one from Pocket ID claims.

    Order:
    1. Look up by pocket_id_sub (already linked user).
    2. Try to link to existing user via invite token.
    3. Fall back to JIT provisioning (group-gated).
    """
    pocket_id_sub = claims.get("sub", "")

    # 1. Already linked
    user = await _resolve_user_by_pocket_id_sub(db, pocket_id_sub)
    if user:
        return user

    # 2. Link existing user via invite
    linked_user = await _link_existing_user_via_invite(db, claims)
    if linked_user:
        return linked_user

    # 3. JIT provision (group-gated fallback)
    return await _jit_provision_user(db, claims)


class PocketIdAuthMiddleware(BaseHTTPMiddleware):
    """
    Authenticate requests using Pocket ID OIDC JWT tokens.

    The frontend authenticates with Pocket ID and receives an access token.
    The frontend sends this token to the backend in the Authorization header.
    This middleware validates the JWT token using Pocket ID's JWKS endpoint.

    On first auth, the user is resolved by:
    1. Looking up by pocket_id_sub (existing linked user).
    2. Linking to a pre-existing user via invite token.
    3. JIT provisioning (group-gated fallback for direct Pocket ID signups).
    """

    async def dispatch(self, request: Request, call_next) -> Any:
        request.state.user = None
        request.state.is_admin = False
        request.state.auth_groups = []

        # Public routes that don't require authentication
        public_paths = {"/health", "/docs", "/openapi.json", "/redoc"}
        if request.url.path in public_paths:
            return await call_next(request)

        # Extract the Authorization header
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return await call_next(request)

        token = auth_header.split(" ", 1)[-1].strip()
        if not token:
            return await call_next(request)

        claims = await validate_pocket_id_token(token)
        if claims is None:
            return await call_next(request)

        async with async_session() as db:
            try:
                user = await _resolve_or_create_user(db, claims)
                await db.commit()
                await db.refresh(user)
            except ValueError as e:
                # JIT provisioning rejected (no groups)
                logger.info("Auth rejected: %s", e)
                return JSONResponse(
                    status_code=403,
                    content={"detail": str(e)},
                )

            if user:
                request.state.user = user

                # Use cached SSO data from DB (always available, never blocks)
                request.state.auth_groups = user.sso_groups or []
                request.state.sso_display_name = user.sso_display_name
                request.state.is_admin = (
                    "admins" in request.state.auth_groups or user.is_admin
                )

                # Background sync: try to refresh SSO data from Pocket ID.
                # Fire-and-forget — never blocks the request.
                _background_sync_sso(user, claims.get("sub", ""))

        return await call_next(request)
