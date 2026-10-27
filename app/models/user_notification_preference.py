"""Per-user notification category preferences (opt-out: missing row = enabled)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.user import User

NOTIFICATION_CATEGORIES = (
    "meetup_invite",      # New meetup announcements
    "waitlist",            # Waitlist alerts
    "chat",                # Chat messages
    "meetup_cancelled",   # Meetup cancelled
    "kickoff_reminder",    # Kickoff 1h reminder
    "rating_reminder",     # Post-meetup rating reminder
)


class UserNotificationPreference(Base):
    __tablename__ = "user_notification_preferences"
    __table_args__ = (
        CheckConstraint(
            "category IN ('meetup_invite', 'waitlist', 'chat', 'meetup_cancelled', 'kickoff_reminder', 'rating_reminder')",
            name="chk_notification_category",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    category: Mapped[str] = mapped_column(String)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    user: Mapped[User] = relationship("User", back_populates="notification_preferences")
