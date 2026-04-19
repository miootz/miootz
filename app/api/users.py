import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.game_template import GameTemplate
from app.models.game_template_subscription import GameTemplateSubscription
from app.models.user import User
from app.models.web_push_subscription import WebPushSubscription
from app.schemas.user import SSOIdentity, UserMe, UserProfileUpdate
from app.services.avatar_images import (
    CropPixels,
    center_square_crop_pixels_dict,
    clamp_crop_to_image,
    crop_resize_save_jpeg,
    default_square_avatar,
    load_uploaded_image,
)
from app.services.skill_service import update_user_calculated_skill
from app.services.template_subscriptions import user_wants_template_notifications
from pydantic import BaseModel, Field

router = APIRouter(prefix="/users", tags=["users"])

ALLOWED_AVATAR_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
_AVATAR_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def _fs_path(relative: str | None) -> str | None:
    if not relative or not relative.startswith("/uploads/"):
        return None
    return os.path.join(settings.UPLOAD_DIR, relative.removeprefix("/uploads/"))


def _remove_upload_file(relative: str | None) -> None:
    p = _fs_path(relative)
    if p and os.path.isfile(p):
        os.remove(p)


class CropPixelsIn(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(ge=1)
    height: int = Field(ge=1)


class AvatarCropIn(BaseModel):
    crop_pixels: CropPixelsIn


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

    try:
        img = load_uploaded_image(raw)
    except OSError:
        raise HTTPException(
            status_code=400,
            detail="Could not read image data",
        ) from None

    ext = _AVATAR_EXT.get(ct, ".jpg")
    orig_name = f"{uuid.uuid4()}_src{ext}"
    orig_fs = os.path.join(settings.UPLOAD_DIR, orig_name)
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    with open(orig_fs, "wb") as buffer:
        buffer.write(raw)

    old_orig = user.profile_pic_original
    old_disp = user.profile_pic
    disp_rel = f"/uploads/avatar_{user.id}.jpg"
    disp_fs = os.path.join(settings.UPLOAD_DIR, f"avatar_{user.id}.jpg")

    default_square_avatar(img, disp_fs)

    if old_orig:
        _remove_upload_file(old_orig)
    if old_disp and old_disp != disp_rel:
        _remove_upload_file(old_disp)

    user.profile_pic_original = f"/uploads/{orig_name}"
    user.profile_pic = disp_rel
    w, h = img.size
    user.avatar_crop_pixels = center_square_crop_pixels_dict(w, h)
    await db.commit()
    await db.refresh(user)

    return {
        "profile_pic": user.profile_pic,
        "profile_pic_original": user.profile_pic_original,
        "avatar_crop_pixels": user.avatar_crop_pixels,
    }


@router.post("/me/avatar/crop")
async def save_avatar_crop(
    body: AvatarCropIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = await db.get(User, current_user.id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    source_rel = user.profile_pic_original or user.profile_pic
    if not source_rel:
        raise HTTPException(status_code=400, detail="No avatar to crop")

    src_fs = _fs_path(source_rel)
    if not src_fs or not os.path.isfile(src_fs):
        raise HTTPException(status_code=404, detail="Avatar source file missing")

    with open(src_fs, "rb") as f:
        raw = f.read()
    try:
        img = load_uploaded_image(raw)
    except OSError:
        raise HTTPException(
            status_code=400,
            detail="Could not read image data",
        ) from None

    iw, ih = img.size
    cp = CropPixels(
        x=body.crop_pixels.x,
        y=body.crop_pixels.y,
        width=body.crop_pixels.width,
        height=body.crop_pixels.height,
    )
    box = clamp_crop_to_image(cp, iw, ih)
    disp_rel = f"/uploads/avatar_{user.id}.jpg"
    disp_fs = os.path.join(settings.UPLOAD_DIR, f"avatar_{user.id}.jpg")
    old_disp = user.profile_pic
    crop_resize_save_jpeg(img, box, disp_fs)

    x1, y1, x2, y2 = box
    user.avatar_crop_pixels = {
        "x": x1,
        "y": y1,
        "width": x2 - x1,
        "height": y2 - y1,
    }
    user.profile_pic = disp_rel
    if old_disp and old_disp != disp_rel:
        _remove_upload_file(old_disp)
    await db.commit()
    await db.refresh(user)

    return {
        "profile_pic": user.profile_pic,
        "avatar_crop_pixels": user.avatar_crop_pixels,
    }
