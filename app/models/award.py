"""Weather Hero award: a stacking, manually granted spot guarantee.

An admin awards it to all confirmed attendees of a rainy meetup (one button).
A waitlisted user redeems an unused award to upgrade to confirmed — the
most-recently-joined confirmed player is demoted to the waitlist in exchange.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.timeutil import utcnow


class WeatherHeroAward(Base):
    __tablename__ = "weather_hero_awards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    #: Meetup the award was granted for.
    granted_meetup_id: Mapped[int | None] = mapped_column(
        ForeignKey("meetups.id"), nullable=True
    )
    granted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    used_meetup_id: Mapped[int | None] = mapped_column(ForeignKey("meetups.id"), nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
