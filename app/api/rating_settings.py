from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.api.users import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.services.audit import log_action
from app.services.rating_settings import PeerRatingMode, get_rating_settings
from app.services.skill_service import refresh_player_skills

router = APIRouter(prefix="/rating-settings", tags=["ratings"])


class RatingSettingsBody(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    computed_scores: bool
    peer_rating_mode: PeerRatingMode


@router.get("", response_model=RatingSettingsBody)
async def read_rating_settings(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await get_rating_settings(db)


@router.patch("", response_model=RatingSettingsBody)
async def update_rating_settings(
    body: RatingSettingsBody,
    request: Request,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(text("BEGIN IMMEDIATE"))
    settings = await get_rating_settings(db)
    changed = (
        settings.computed_scores != body.computed_scores
        or settings.peer_rating_mode != body.peer_rating_mode
    )
    settings.computed_scores = body.computed_scores
    settings.peer_rating_mode = body.peer_rating_mode
    db.add(settings)
    await db.flush()
    if changed and settings.computed_scores:
        await refresh_player_skills(db)
    await db.commit()
    if changed:
        log_action(
            request,
            "rating",
            "rating.settings_updated",
            f"Computed scores: {body.computed_scores}, peer ratings: {body.peer_rating_mode}",
        )
    return settings
