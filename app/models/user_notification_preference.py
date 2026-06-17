"""Per-user notification category preferences (opt-out: missing row = enabled)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.user import User

NOTIFICATION_CATEGORIES = (
    "session_invite",      # New session announcements
    "waitlist",            # Waitlist alerts
    "chat",                # Chat messages
    "session_cancelled",   # Session cancelled
    "kickoff_reminder",    # Kickoff 1h reminder
    "rating_reminder",     # Post-session rating reminder
)


class UserNotificationPreference(Base):
    __tablename__ = "user_notification_preferences"
    __table_args__ = (
        CheckConstraint(
            "category IN ('session_invite', 'waitlist', 'chat', 'session_cancelled', 'kickoff_reminder', 'rating_reminder')",
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
