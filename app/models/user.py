from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import String, Integer, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.game_template_subscription import GameTemplateSubscription


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    phone: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=True)
    full_name: Mapped[str] = mapped_column(String, nullable=True)
    # Full uploaded image (JPEG/PNG/WebP path under /uploads/...).
    profile_pic_original: Mapped[str | None] = mapped_column(String, nullable=True)
    # Square JPEG used everywhere in the app (cropped from original).
    profile_pic: Mapped[str | None] = mapped_column(String, nullable=True)
    # Last crop region on the original upload (natural pixels x,y,width,height).
    avatar_crop_pixels: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    skill_level: Mapped[int] = mapped_column(Integer, nullable=True)
    self_assessed_skill: Mapped[int] = mapped_column(Integer, nullable=True)
    calculated_skill: Mapped[int] = mapped_column(Integer, nullable=True)
    is_admin: Mapped[bool] = mapped_column(default=False)

    game_template_subscriptions: Mapped[list["GameTemplateSubscription"]] = relationship(
        "GameTemplateSubscription",
        back_populates="user",
        cascade="all, delete-orphan",
    )
