import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.web_push_subscription import WebPushSubscription
from app.schemas.user import SSOIdentity, UserMe, UserProfileUpdate
from app.services.skill_service import update_user_calculated_skill
from pydantic import BaseModel, Field

router = APIRouter(prefix="/users", tags=["users"])

ALLOWED_AVATAR_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
_AVATAR_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def get_current_user(request: Request) -> User:
    user = request.state.user
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return user


def sso_snapshot(request: Request) -> dict | None:
    u = getattr(request.state, "sso_username", None)
    e = getattr(request.state, "sso_email", None)
    d = getattr(request.state, "sso_display_name", None)
    if not u and not e and not d:
        return None
    return SSOIdentity(username=u, email=e, display_name=d).model_dump()


def me_envelope(request: Request, user: User) -> dict:
    return {
        "user": UserMe.model_validate(user).model_dump(),
        "sso": sso_snapshot(request),
    }


@router.get("/me")
async def get_my_profile(
    request: Request, current_user: User = Depends(get_current_user)
):
    """Same identity payload as `GET /me` minus admin flags (use `/me` for full auth context)."""
    return me_envelope(request, current_user)


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
    sync_dn = dumped.pop("sync_display_name_from_sso", False)
    sync_em = dumped.pop("sync_email_from_sso", False)

    if sync_dn:
        dn = getattr(request.state, "sso_display_name", None)
        if not dn:
            raise HTTPException(
                status_code=400,
                detail="No display name from Authelia (Remote-Name) on this request",
            )
        user.full_name = dn

    if sync_em:
        new_email = getattr(request.state, "sso_email", None)
        if not new_email:
            raise HTTPException(
                status_code=400,
                detail="No email from Authelia (Remote-Email) on this request",
            )
        new_email = new_email.strip()
        if new_email.lower() != user.email.lower():
            conflict = await db.execute(
                select(User.id).where(func.lower(User.email) == new_email.lower())
            )
            other_id = conflict.scalar_one_or_none()
            if other_id is not None and other_id != user.id:
                raise HTTPException(
                    status_code=409,
                    detail="That email is already used by another account",
                )
        user.email = new_email

    skill_changed = False
    if "self_assessed_skill" in dumped:
        v = dumped.pop("self_assessed_skill")
        if v is not None:
            user.self_assessed_skill = v
            user.skill_level = v
            skill_changed = True
    if "skill_level" in dumped:
        v = dumped.pop("skill_level")
        if v is not None and not skill_changed:
            user.skill_level = v
            user.self_assessed_skill = v
            skill_changed = True

    for key, value in dumped.items():
        if key in ("full_name", "phone") and value == "":
            value = None
        setattr(user, key, value)

    await db.commit()
    await db.refresh(user)
    if skill_changed:
        await update_user_calculated_skill(db, user_id=user.id)

    return {"message": "Profile updated successfully"}


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: dict[str, str]


@router.get("/me/push/config")
async def push_config(_: User = Depends(get_current_user)):
    """VAPID public key for `PushManager.subscribe` (null if Web Push is disabled)."""
    return {
        "publicKey": settings.VAPID_PUBLIC_KEY or None,
    }


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

    result = await db.execute(
        select(WebPushSubscription).where(
            WebPushSubscription.endpoint == body.endpoint
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.user_id = current_user.id
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
    await db.execute(
        delete(WebPushSubscription).where(
            WebPushSubscription.user_id == current_user.id
        )
    )
    await db.commit()
    return {"status": "ok"}


class AdminSelfAssessedBody(BaseModel):
    self_assessed_skill: int = Field(..., ge=1, le=5)


@router.patch("/{user_id}/self-assessed-skill")
async def admin_set_self_assessed_skill(
    user_id: int,
    body: AdminSelfAssessedBody,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.self_assessed_skill = body.self_assessed_skill
    user.skill_level = body.self_assessed_skill
    await db.commit()
    await update_user_calculated_skill(db, user_id=user_id)
    return {"message": "Self-assessed skill updated"}


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = await db.get(User, current_user.id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    ct = (file.content_type or "").split(";")[0].strip().lower()
    if ct not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Avatar must be JPEG, PNG, or WebP",
        )

    max_b = settings.MAX_AVATAR_BYTES
    raw = await file.read(max_b + 1)
    if len(raw) > max_b:
        raise HTTPException(
            status_code=413,
            detail=f"Avatar must be at most {max_b // (1024 * 1024)} MB",
        )

    ext = _AVATAR_EXT.get(ct, ".bin")
    filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(settings.UPLOAD_DIR, filename)

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    with open(filepath, "wb") as buffer:
        buffer.write(raw)

    user.profile_pic = f"/uploads/{filename}"
    await db.commit()

    return {"profile_pic": user.profile_pic}
