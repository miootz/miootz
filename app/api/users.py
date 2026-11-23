import logging
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.api.rate_limit import limiter
from app.core.config import settings
from app.core.database import get_db
from app.models.game_template import GameTemplate
from app.models.game_template_subscription import GameTemplateSubscription
from app.models.user import User
from app.models.user_notification_preference import (
    NOTIFICATION_CATEGORIES,
    UserNotificationPreference,
)
from app.models.web_push_subscription import WebPushSubscription
from app.schemas.user import SPECIALTY_OPTIONS, UserProfileUpdate
from app.models.invite import InviteToken
from app.models.meetup import Attendance, MatchScore, Meetup
from app.models.rating import Rating
from app.services import rankings_service
from app.services.web_push import send_test_push
from app.services.pocket_id_client import (
    create_signup_token,
    delete_user,
    get_user_by_id,
)
from app.services.stats_service import get_user_statistics
from app.services.skill_service import refresh_player_skills, update_user_calculated_skill
from app.services.rating_settings import get_rating_settings, selected_rating
from app.services.template_subscriptions import user_wants_template_notifications
from app.services.audit import log_action
from pydantic import BaseModel, ConfigDict, Field
from app.core.timeutil import utcnow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

# Avatars are managed via Pocket ID — users set their profile picture at
# {POCKET_ID_APP_URL}/settings/account.  The avatar URL is computed from
# the user's pocket_id_sub: {POCKET_ID_APP_URL}/api/users/{sub}/profile-picture.png


def _slugify(s: str) -> str:
    return "".join(c.lower() for c in s if c.isalnum())


def _synthetic_email(first_name: str, last_name: str) -> str:
    """Generate a synthetic email for Pocket ID (never shown to the user)."""
    slug = _slugify(f"{first_name} {last_name}") or "player"
    import secrets

    suffix = secrets.token_hex(4)
    return f"{slug}.{suffix}@passkey.internal"


class AdminUserCreate(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=80)
    last_name: str = Field(..., min_length=1, max_length=80)
    calculated_skill: float | None = Field(None, ge=0.5, le=5, multiple_of=0.5)


@router.post("")
async def admin_create_user(
    body: AdminUserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Create a new user account (admin only). User has no Pocket ID link yet."""
    first_name = body.first_name.strip()
    last_name = body.last_name.strip()
    if not first_name or not last_name:
        raise HTTPException(
            status_code=400, detail="First name and last name are required"
        )

    user = User(
        sso_display_name=f"{first_name} {last_name}",
        seed_skill=body.calculated_skill,
        calculated_skill=body.calculated_skill,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    log_action(
        request,
        "user",
        "user.created",
        f"Created user '{first_name} {last_name}' (no Pocket ID link yet)",
    )

    return {
        "id": user.id,
        "pocket_id_sub": user.pocket_id_sub,
        "display_name": user.sso_display_name,
        "username": None,
        "avatar_url": user.avatar_url,
        "calculated_skill": user.calculated_skill,
        "seed_skill": user.seed_skill,
        "pac": user.pac,
        "dri": user.dri,
        "primary_specialty": user.primary_specialty,
        "secondary_specialty": user.secondary_specialty,
        "is_admin": user.is_admin,
        "has_pocket_id": bool(user.pocket_id_sub),
    }


@router.post("/{user_id}/invite")
async def admin_generate_invite(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Generate a Pocket ID invite link for an existing user (admin only)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.pocket_id_sub:
        raise HTTPException(
            status_code=409,
            detail="User already has a Pocket ID account",
        )

    display = user.sso_display_name or ""
    parts = display.split(maxsplit=1)
    first_name = parts[0] if len(parts) else "player"
    last_name = parts[1] if len(parts) > 1 else ""

    synthetic_email = _synthetic_email(first_name, last_name)

    try:
        pocket_token = await create_signup_token(
            email=synthetic_email,
            ttl="168h",  # 7 days
            usage_limit=1,
            user_group_ids=(
                [settings.POCKET_ID_MEMBERS_GROUP_ID]
                if settings.POCKET_ID_MEMBERS_GROUP_ID
                else None
            ),
        )
    except Exception as e:
        logger.exception("Failed to create Pocket ID signup token: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Failed to create invite. Pocket ID may not be available.",
        ) from e

    if not pocket_token:
        raise HTTPException(status_code=502, detail="Failed to create invite.")

    token = pocket_token.get("token", "")
    expires_at = (
        datetime.fromisoformat(pocket_token.get("expiresAt", ""))
        if pocket_token.get("expiresAt")
        else utcnow() + timedelta(days=7)
    )

    invite = InviteToken(
        token=token,
        first_name=first_name,
        last_name=last_name,
        expires_at=expires_at,
        user_id=user.id,
    )
    db.add(invite)
    await db.commit()
    log_action(
        request,
        "user",
        "user.invite_generated",
        f"Generated a Pocket ID invite link for {display} "
        f"(expires {expires_at:%Y-%m-%d})",
    )

    base = settings.POCKET_ID_APP_URL.rstrip("/")
    invite_link = f"{base}/st/{token}"

    return {
        "invite_link": invite_link,
        "expires_at": expires_at.isoformat(),
    }


def get_current_user(request: Request) -> User:
    user = request.state.user
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return user


@router.get("/me")
async def get_my_profile(
    request: Request, current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Same identity payload as `GET /me` minus admin flags (use `/me` for full auth context)."""
    return {
        "user": {
            "id": current_user.id,
            "pocket_id_sub": current_user.pocket_id_sub,
            "display_name": getattr(request.state, "sso_display_name", None),
            "avatar_url": current_user.avatar_url,
            "calculated_skill": selected_rating(
                current_user, (await get_rating_settings(db)).computed_scores
            ),
            "primary_specialty": current_user.primary_specialty,
            "secondary_specialty": current_user.secondary_specialty,
            "is_admin": getattr(request.state, "is_admin", False),
        },
    }


class GameTemplateSubscriptionPatch(BaseModel):
    notifications_enabled: bool


@router.get("/me/game-template-subscriptions")
async def list_my_game_template_subscriptions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Active templates with effective notification preference (default on; explicit row can opt out)."""
    result = await db.execute(
        select(GameTemplate)
        .where(GameTemplate.is_active.is_(True))
        .order_by(GameTemplate.name.asc())
    )
    templates = result.scalars().all()
    items = []
    for t in templates:
        want = await user_wants_template_notifications(db, current_user.id, t.id)
        items.append(
            {
                "game_template_id": t.id,
                "name": t.name,
                "notifications_enabled": want,
            }
        )
    return {"items": items}


@router.patch("/me/game-template-subscriptions/{template_id}")
async def patch_my_game_template_subscription(
    template_id: int,
    body: GameTemplateSubscriptionPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tmpl = await db.get(GameTemplate, template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    r = await db.execute(
        select(GameTemplateSubscription).where(
            GameTemplateSubscription.user_id == current_user.id,
            GameTemplateSubscription.game_template_id == template_id,
        )
    )
    row = r.scalar_one_or_none()
    if body.notifications_enabled:
        if row:
            await db.delete(row)
    else:
        if row:
            row.notifications_enabled = False
        else:
            db.add(
                GameTemplateSubscription(
                    user_id=current_user.id,
                    game_template_id=template_id,
                    notifications_enabled=False,
                )
            )
    await db.commit()
    return {
        "status": "ok",
        "game_template_id": template_id,
        "notifications_enabled": body.notifications_enabled,
    }


@router.patch("/me")
async def update_profile(
    request: Request,
    update_data: UserProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = await db.get(User, current_user.id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    dumped = update_data.model_dump(exclude_unset=True)

    for key, value in dumped.items():
        if key in ("primary_specialty", "secondary_specialty") and value == "":
            value = None
        setattr(user, key, value)

    await db.commit()
    await db.refresh(user)

    return {"message": "Profile updated successfully"}


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: dict[str, str]


def _validate_push_endpoint(endpoint: str) -> None:
    """Reject push endpoints outside the configured host allowlist.

    The server POSTs a VAPID-signed request to this URL, so an arbitrary
    endpoint is a blind SSRF to the internal network.
    """
    from urllib.parse import urlparse

    parsed = urlparse(endpoint)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid push endpoint")
    host = parsed.hostname.lower()
    allowed = [
        h.strip().lower()
        for h in settings.PUSH_ENDPOINT_HOSTS.split(",")
        if h.strip()
    ]
    if not any(
        host == h.lstrip(".") or host.endswith(h) for h in allowed
    ):
        raise HTTPException(
            status_code=400,
            detail="Push endpoint host not allowed",
        )


@router.get("/me/push/config")
async def push_config(_: User = Depends(get_current_user)):
    """VAPID public key for `PushManager.subscribe` (null if Web Push is disabled)."""
    return {
        "publicKey": settings.VAPID_PUBLIC_KEY or None,
    }


@router.post("/me/push/test")
@limiter.limit("3 per minute")
async def test_my_push(
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, int]:
    if not settings.VAPID_PUBLIC_KEY or not settings.VAPID_PRIVATE_KEY:
        raise HTTPException(status_code=503, detail="Web Push is not configured on the server")
    return await send_test_push(db, admin.id)


@router.post("/me/push/subscription")
async def save_push_subscription(
    body: PushSubscriptionIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not settings.VAPID_PUBLIC_KEY or not settings.VAPID_PRIVATE_KEY:
        raise HTTPException(
            status_code=503, detail="Web Push is not configured on the server"
        )
    p256dh = body.keys.get("p256dh")
    auth = body.keys.get("auth")
    if not p256dh or not auth:
        raise HTTPException(status_code=400, detail="Missing p256dh or auth key")

    _validate_push_endpoint(body.endpoint)

    result = await db.execute(
        select(WebPushSubscription).where(WebPushSubscription.endpoint == body.endpoint)
    )
    row = result.scalar_one_or_none()
    if row:
        if row.user_id != current_user.id:
            raise HTTPException(
                status_code=409,
                detail="This push endpoint is already registered to another account",
            )
        row.p256dh = p256dh
        row.auth = auth
    else:
        db.add(
            WebPushSubscription(
                user_id=current_user.id,
                endpoint=body.endpoint,
                p256dh=p256dh,
                auth=auth,
            )
        )
    await db.commit()
    return {"status": "ok"}


@router.delete("/me/push/subscription")
async def delete_push_subscriptions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Deprecated — use DELETE /me/push/subscriptions/{id} to remove individual devices."""
    await db.execute(
        delete(WebPushSubscription).where(
            WebPushSubscription.user_id == current_user.id
        )
    )
    await db.commit()
    return {"status": "ok"}


@router.get("/me/push/subscriptions")
async def list_push_subscriptions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all registered push devices for the current user."""
    result = await db.execute(
        select(WebPushSubscription)
        .where(WebPushSubscription.user_id == current_user.id)
        .order_by(WebPushSubscription.created_at.desc())
    )
    subs = result.scalars().all()
    return {
        "items": [
            {
                "id": sub.id,
                "endpoint": sub.endpoint,
                "created_at": sub.created_at.isoformat(),
            }
            for sub in subs
        ]
    }


@router.delete("/me/push/subscriptions/{subscription_id}")
async def delete_push_subscription(
    subscription_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a specific push device."""
    sub = await db.get(WebPushSubscription, subscription_id)
    if not sub or sub.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Subscription not found")
    await db.delete(sub)
    await db.commit()
    return {"status": "ok"}


class NotificationPreferencePatch(BaseModel):
    enabled: bool


@router.get("/me/notification-preferences")
async def list_notification_preferences(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all notification categories with current enabled state (missing row = enabled)."""
    result = await db.execute(
        select(UserNotificationPreference).where(
            UserNotificationPreference.user_id == current_user.id
        )
    )
    explicit = {row.category: row.enabled for row in result.scalars().all()}
    items = []
    for cat in NOTIFICATION_CATEGORIES:
        items.append(
            {
                "category": cat,
                "enabled": explicit.get(cat, True),
            }
        )
    return {"items": items}


@router.patch("/me/notification-preferences/{category}")
async def patch_notification_preference(
    category: str,
    body: NotificationPreferencePatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if category not in NOTIFICATION_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category: {category}")
    r = await db.execute(
        select(UserNotificationPreference).where(
            UserNotificationPreference.user_id == current_user.id,
            UserNotificationPreference.category == category,
        )
    )
    row = r.scalar_one_or_none()
    if body.enabled:
        # Opt back in: delete explicit row (default is enabled)
        if row:
            await db.delete(row)
    else:
        # Opt out: create or set to disabled
        if row:
            row.enabled = False
        else:
            db.add(
                UserNotificationPreference(
                    user_id=current_user.id,
                    category=category,
                    enabled=False,
                )
            )
    await db.commit()
    return {
        "status": "ok",
        "category": category,
        "enabled": body.enabled,
    }


class AdminUserListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    pocket_id_sub: str | None
    display_name: str | None = None
    username: str | None = None
    avatar_url: str | None = None
    calculated_skill: float | None = None
    seed_skill: float | None = None
    pac: float | None = None
    dri: float | None = None
    sho_override: float | None = None
    pas_override: float | None = None
    def_override: float | None = None
    primary_specialty: SPECIALTY_OPTIONS | None = None
    secondary_specialty: SPECIALTY_OPTIONS | None = None
    is_admin: bool = False
    has_pocket_id: bool = False


class AdminUserUpdate(BaseModel):
    calculated_skill: float | None = Field(None, ge=0, le=5)
    seed_skill: float | None = Field(None, ge=0, le=5)
    pac: float | None = Field(None, ge=1, le=5)
    dri: float | None = Field(None, ge=1, le=5)
    sho_override: float | None = Field(None, ge=1, le=5)
    pas_override: float | None = Field(None, ge=1, le=5)
    def_override: float | None = Field(None, ge=1, le=5)
    primary_specialty: SPECIALTY_OPTIONS | None = None
    secondary_specialty: SPECIALTY_OPTIONS | None = None
    is_admin: bool | None = None
    display_name: str | None = None


def _user_out(user: User, sso: dict[str, Any] | None, computed_scores: bool) -> dict[str, Any]:
    return {
        **AdminUserListOut.model_validate(user).model_dump(),
        "calculated_skill": selected_rating(user, computed_scores),
        "display_name": sso.get("displayName") if sso else user.sso_display_name,
        "username": (
            sso.get("preferredUsername") or sso.get("username")
            if sso
            else user.sso_preferred_username
        ),
        "has_pocket_id": bool(user.pocket_id_sub),
    }


async def _enrich(users: list[User], computed_scores: bool) -> list[dict[str, Any]]:
    """Fetch fresh SSO profiles in parallel for users with a pocket_id_sub."""
    subs = [u for u in users if u.pocket_id_sub]
    cache: dict[str, dict[str, Any]] = {}
    if subs:
        import asyncio

        results = await asyncio.gather(
            *(get_user_by_id(u.pocket_id_sub) for u in subs),
        )
        for u, sso_data in zip(subs, results, strict=True):
            if sso_data:
                cache[u.pocket_id_sub] = sso_data
    return [_user_out(u, cache.get(u.pocket_id_sub), computed_scores) for u in users]


@router.get("")
async def list_users_admin(
    q: str | None = None,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """List players for the admin UI (search + pagination), enriched with fresh Pocket ID profile data."""
    stmt = select(User)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                User.sso_display_name.ilike(like),
                User.sso_preferred_username.ilike(like),
                User.pocket_id_sub.ilike(like),
            )
        )
    total = (
        await db.execute(
            select(func.count()).select_from(stmt.subquery())
        )
    ).scalar()
    total = total or 0
    rows = (
        (
            await db.execute(
                stmt.order_by(User.sso_display_name.asc(), User.pocket_id_sub.asc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    settings = await get_rating_settings(db)
    return {"items": await _enrich(list(rows), settings.computed_scores), "total": total}


@router.get("/{user_id}/history")
async def admin_get_player_history(
    user_id: int,
    request: Request,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    history_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Player detail payload: profile + stats + paginated attendance history.

    Admins see anyone; a member may view their own history (self-profile)."""
    if not getattr(request.state, "is_admin", False) and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Admin only")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    total = (
        await db.execute(
            select(func.count(Attendance.id)).where(Attendance.user_id == user_id)
        )
    ).scalar()
    total = total or 0

    res = (
        await db.execute(
            select(Attendance, Meetup)
            .join(Meetup, Meetup.id == Attendance.meetup_id)
            .where(Attendance.user_id == user_id)
            .order_by(Meetup.start_time.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    att_rows = res.all()

    meetup_ids = [m.id for _, m in att_rows]
    score_map: dict[tuple[int, str], int] = {}
    rating_map: dict[int, float] = {}
    if meetup_ids and not history_only:
        scores = await db.execute(
            select(MatchScore).where(
                MatchScore.meetup_id.in_(meetup_ids),
                MatchScore.player_id == user_id,
            )
        )
        score_map = {
            (s.meetup_id, s.type): s.score for s in scores.scalars().all()
        }
    if meetup_ids:
        ratings = await db.execute(
            select(Rating.meetup_id, func.avg(Rating.score))
            .where(
                Rating.meetup_id.in_(meetup_ids),
                Rating.ratee_id == user_id,
                Rating.score.between(1, 5),
            )
            .group_by(Rating.meetup_id)
        )
        rating_map = {
            mid: round(float(avg), 2) for mid, avg in ratings.all() if avg is not None
        }

    items = []
    metrics_map = await rankings_service.get_user_meetup_metrics(
        db, user_id, meetup_ids
    )
    for att, m in att_rows:
        pm = metrics_map.get(m.id, {k: 0 for k in rankings_service.METRIC_KEYS})
        items.append(
            {
                "meetup_id": m.id,
                "start_time": m.start_time.isoformat(),
                "location": m.location,
                "status": att.status,
                "previous_status": att.previous_status,
                "joined_at": att.joined_at.isoformat(),
                "score_team": score_map.get((m.id, "team")),
                "score_individual": score_map.get((m.id, "individual")),
                "rating_avg": rating_map.get(m.id),
                "metrics": {
                    **pm,
                    "win_rate": round(pm["wins"] / pm["matches"], 3)
                    if pm["matches"]
                    else 0.0,
                },
            }
        )

    history = {"items": items, "total": total}
    if history_only:
        return {"history": history}

    stats = await get_user_statistics(db, user_id)
    return {
        "user": (await _enrich([user], stats["computed_scores"]))[0],
        "stats": stats,
        "history": history,
    }


@router.patch("/{user_id}")
async def admin_update_user(
    user_id: int,
    body: AdminUserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Update a user's profile fields (admin only)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    dumped = body.model_dump(exclude_unset=True)

    for key in ("primary_specialty", "secondary_specialty"):
        if key in dumped and dumped[key] == "":
            dumped[key] = None

    if "display_name" in dumped:
        val = dumped.pop("display_name")
        user.sso_display_name = val if val else None

    if "calculated_skill" in dumped:
        dumped.setdefault("seed_skill", dumped.pop("calculated_skill"))

    for key, value in dumped.items():
        setattr(user, key, value)

    rating_fields = {"seed_skill", "pac", "dri", "sho_override", "pas_override", "def_override"}
    if rating_fields & dumped.keys():
        await update_user_calculated_skill(db, user.id, commit=False)
    await db.commit()
    await db.refresh(user)
    changed = ", ".join(sorted(body.model_dump(exclude_unset=True)))
    log_action(
        request,
        "user",
        "user.updated",
        f"Updated user '{user.sso_display_name or user.id}' — changed: {changed}",
    )
    return {"message": "User updated successfully"}


@router.delete("/{user_id}")
async def admin_delete_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Delete a user from both the local DB and Pocket ID (admin only)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    del_name = user.sso_display_name or str(user.id)
    # Remove from Pocket ID first
    if user.pocket_id_sub:
        await delete_user(user.pocket_id_sub)
    from app.services.deletes import delete_user_children

    await delete_user_children(db, user.id)
    await db.delete(user)
    await db.flush()
    await refresh_player_skills(db)
    await db.commit()
    log_action(
        request,
        "user",
        "user.deleted",
        f"Deleted user '{del_name}' from the app"
        + (" and Pocket ID" if user.pocket_id_sub else ""),
    )
    return {"message": "User deleted successfully"}
