from typing import Literal

from sqlalchemy import String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.user import User


PeerRatingMode = Literal["off", "teammates-only", "everyone"]
DEFAULT_PEER_RATING_MODE: PeerRatingMode = "teammates-only"


class RatingSettings(Base):
    __tablename__ = "rating_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    computed_scores: Mapped[bool] = mapped_column(default=True)
    peer_rating_mode: Mapped[PeerRatingMode] = mapped_column(
        String, default=DEFAULT_PEER_RATING_MODE
    )


async def get_rating_settings(db: AsyncSession) -> RatingSettings:
    row = await db.get(RatingSettings, 1)
    return (
        row
        if row is not None
        else RatingSettings(
            id=1, computed_scores=True, peer_rating_mode=DEFAULT_PEER_RATING_MODE
        )
    )


def selected_rating(user: User, computed_scores: bool) -> float | None:
    return user.calculated_skill if computed_scores else user.seed_skill
