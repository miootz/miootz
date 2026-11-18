from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.game_template_subscription import GameTemplateSubscription
    from app.models.user_notification_preference import UserNotificationPreference


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    #: Pocket ID user UUID (sub claim from JWT) — primary identity FK.
    #: Nullable for unclaimed plus-one guest placeholders.
    pocket_id_sub: Mapped[str | None] = mapped_column(
        String, unique=True, nullable=True, index=True
    )
    #: Cached display name from Pocket ID (synced on JIT + background refresh)
    sso_display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    #: Cached preferredUsername/username from Pocket ID (synced on JIT + background refresh)
    sso_preferred_username: Mapped[str | None] = mapped_column(String, nullable=True)
    #: Cached group names from Pocket ID, e.g. ["admins", "members"] (synced on auth)
    sso_groups: Mapped[list | None] = mapped_column(JSON, nullable=True)
    #: When SSO data was last refreshed from Pocket ID (throttles background sync)
    sso_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    #: Stable identity for workbook imports, even when Pocket ID changes the username.
    historical_roster_name: Mapped[str | None] = mapped_column(
        String, unique=True, nullable=True, index=True
    )

    # ── App-specific fields (game data only) ──────────────────────────
    #: Computed skill (1–5 scale). Seeded by admins at player creation /
    #: guest invite; recomputed from peer ratings + miss decay; admin-editable.
    calculated_skill: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: Primary playing position: ATT, MID, DEF, GK
    primary_specialty: Mapped[str | None] = mapped_column(String, nullable=True)
    #: Secondary playing position: ATT, MID, DEF, GK
    secondary_specialty: Mapped[str | None] = mapped_column(String, nullable=True)
    is_admin: Mapped[bool] = mapped_column(default=False)

    @property
    def avatar_url(self) -> str | None:
        """Pocket ID profile-picture URL (computed from pocket_id_sub)."""
        from app.services.avatar_url import get_avatar_url

        return get_avatar_url(self.pocket_id_sub)

    @property
    def display_name(self) -> str:
        """Display name: sso_display_name > sso_preferred_username > sub prefix > id."""
        if self.sso_display_name:
            return self.sso_display_name
        if self.sso_preferred_username:
            return self.sso_preferred_username
        if self.pocket_id_sub:
            return self.pocket_id_sub[:8]
        return f"user-{self.id}"

    game_template_subscriptions: Mapped[list[GameTemplateSubscription]] = relationship(
        "GameTemplateSubscription",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    notification_preferences: Mapped[list[UserNotificationPreference]] = relationship(
        "UserNotificationPreference",
        cascade="all, delete-orphan",
    )
