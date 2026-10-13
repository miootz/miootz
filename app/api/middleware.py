import asyncio
import logging
import re
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.database import async_session
from app.core.timeutil import utcnow
from app.models.invite import InviteToken
from app.models.user import User
from app.services.pocket_id_jwt import validate_pocket_id_token
from app.services.pocket_id_client import get_user_by_id

logger = logging.getLogger(__name__)


async def _sync_sso_data(user: User, pocket_id_sub: str) -> None:
    """Sync SSO data from Pocket ID admin API into the local DB.

    Called synchronously on JIT provisioning and as a throttled background
    refresh on subsequent auth.
    """
    try:
        async with async_session() as db:
            sso_user = await get_user_by_id(pocket_id_sub)
            if sso_user is None:
                return
            user_groups = sso_user.get("userGroups", [])
            group_names = [
                g["name"]
                for g in user_groups
                if isinstance(g, dict) and isinstance(g.get("name"), str)
            ]
            display_name = sso_user.get("displayName")
            preferred_username = sso_user.get("preferredUsername") or sso_user.get(
                "username"
            )
            # Re-fetch the user row to avoid stale-state writes
            fresh = await db.get(User, user.id)
            if fresh is None:
                return
            changed = (
                fresh.sso_display_name != display_name
                or fresh.sso_preferred_username != preferred_username
                or fresh.sso_groups != group_names
            )
            if changed:
                fresh.sso_display_name = display_name
                fresh.sso_preferred_username = preferred_username
                fresh.sso_groups = group_names
            # Always stamp the sync time so the throttle clock advances even
            # when nothing changed (prevents retry storms on quiet accounts).
            fresh.sso_synced_at = utcnow()
            await db.commit()
    except Exception:
        logger.exception("SSO sync failed for sub=%s", pocket_id_sub)


#: Strong references to in-flight background SSO sync tasks so they are not
#: garbage-collected mid-flight (asyncio only keeps weak refs to tasks).
_pending_sso_syncs: set[asyncio.Task] = set()

#: Minimum interval between Pocket ID admin-API refreshes per user.
_SSO_SYNC_INTERVAL_SECONDS = 6 * 3600


def _background_sync_sso(user: User, pocket_id_sub: str) -> None:
    """Fire-and-forget throttled background SSO refresh (for existing users)."""
    last = user.sso_synced_at
    if last is not None:
        try:
            if (utcnow() - last).total_seconds() < _SSO_SYNC_INTERVAL_SECONDS:
                return
        except TypeError:
            pass  # unexpected tz-aware legacy value — refresh instead of stalling
    task = asyncio.create_task(_sync_sso_data(user, pocket_id_sub))
    _pending_sso_syncs.add(task)
    task.add_done_callback(_pending_sso_syncs.discard)


async def _resolve_user_by_pocket_id_sub(
    db: AsyncSession, pocket_id_sub: str
) -> User | None:
    """Look up user by Pocket ID sub claim."""
    result = await db.execute(select(User).where(User.pocket_id_sub == pocket_id_sub))
    return result.scalar_one_or_none()


async def _link_existing_user_via_invite(db: AsyncSession, claims: dict) -> User | None:
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
                signup_token = sso_user.get("signupToken") or sso_user.get(
                    "signup_token"
                )
        except Exception:
            logger.debug(
                "Could not fetch Pocket ID user for invite linking (sub=%r)",
                pocket_id_sub,
            )

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
                g["name"]
                for g in user_groups
                if isinstance(g, dict) and isinstance(g.get("name"), str)
            ]
            existing_user.sso_display_name = (
                sso_user.get("displayName") or existing_user.sso_display_name
            )
            existing_user.sso_preferred_username = (
                sso_user.get("preferredUsername")
                or sso_user.get("username")
                or existing_user.sso_preferred_username
            )
            existing_user.sso_groups = groups if groups else None
    except Exception:
        logger.exception(
            "SSO sync failed during invite linking for sub=%s", pocket_id_sub
        )

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
            g["name"]
            for g in user_groups
            if isinstance(g, dict) and isinstance(g.get("name"), str)
        ]
        display_name = sso_user.get("displayName")
        preferred_username = sso_user.get("preferredUsername") or sso_user.get(
            "username"
        )

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


#: Routes reachable without any authentication. Everything else is denied by
#: default (401) unless a valid Pocket ID token resolves a user. Keep this
#: list minimal — the plus-one routes carry their own capability tokens.
#: (The old signed magic-link API was removed entirely: nothing issued the
#: irrevocable tokens anymore and push links now go through authed SPA routes.)
_PUBLIC_EXACT_PATHS = frozenset({"/health", "/docs", "/openapi.json", "/redoc"})
_PUBLIC_PATH_PREFIXES = (
    "/sessions/plus-one/",  # guest claim preview — claim_token is the capability
)

#: Live goal log is readable without auth (plan §4: watchers at home, shared
#: link). GET only — mutating the log still requires a present member/admin.
_PUBLIC_GET_PATH_RES = (re.compile(r"^/sessions/\d+/matches/\d+/goals$"),)

#: SSE endpoints: EventSource cannot send Authorization headers, so the access
#: token is accepted from the `access_token` query param *only* on these paths.
_SSE_TOKEN_QUERY_SUFFIXES = ("/data/events", "/chat/events")


class PocketIdAuthMiddleware(BaseHTTPMiddleware):
    """
    Authenticate requests using Pocket ID OIDC JWT tokens (default-deny).

    The frontend authenticates with Pocket ID and receives an access token.
    The frontend sends this token to the backend in the Authorization header
    (or as `?access_token=` on SSE endpoints, where EventSource cannot set
    headers). The token is validated against Pocket ID's JWKS endpoint.

    Requests without a valid token receive 401 unless the path is in the
    public allowlist below. Endpoints may still perform their own
    authorization checks (ownership, admin) on top of `request.state.user`.

    On first auth, the user is resolved by:
    1. Looking up by pocket_id_sub (existing linked user).
    2. Linking to a pre-existing user via invite token.
    3. JIT provisioning (group-gated fallback for direct Pocket ID signups).
    """

    async def dispatch(self, request: Request, call_next) -> Any:
        request.state.user = None
        request.state.is_admin = False
        request.state.auth_groups = []

        path = request.url.path
        is_public = (
            path in _PUBLIC_EXACT_PATHS
            or path.startswith(_PUBLIC_PATH_PREFIXES)
            or (
                request.method == "GET"
                and any(rx.match(path) for rx in _PUBLIC_GET_PATH_RES)
            )
        )

        # Extract the token: Authorization header first; `access_token` query
        # param is honored only on the two SSE paths (never elsewhere, so
        # tokens don't leak into logs for regular API calls).
        token = ""
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[-1].strip()
        elif path.endswith(_SSE_TOKEN_QUERY_SUFFIXES):
            token = request.query_params.get("access_token", "").strip()

        claims = await validate_pocket_id_token(token) if token else None

        if claims is None:
            if is_public:
                return await call_next(request)
            return JSONResponse(
                status_code=401, content={"detail": "Not authenticated"}
            )

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

            if user is not None:
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

        if request.state.user is None and not is_public:
            return JSONResponse(
                status_code=401, content={"detail": "Not authenticated"}
            )

        return await call_next(request)
