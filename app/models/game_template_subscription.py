"""Per-user notification preference for a game template (default on if no row)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.game_template import GameTemplate
    from app.models.user import User


class GameTemplateSubscription(Base):
    __tablename__ = "game_template_subscriptions"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "game_template_id",
            name="uq_game_template_subscription_user_template",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    game_template_id: Mapped[int] = mapped_column(
        ForeignKey("game_templates.id"), index=True
    )
    #: False = user opted out of new-session emails/pushes for this template.
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped["User"] = relationship(
        "User", back_populates="game_template_subscriptions"
    )
    game_template: Mapped["GameTemplate"] = relationship(
        "GameTemplate", back_populates="subscriptions"
    )
