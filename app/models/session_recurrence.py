"""Weekly recurrence: one rule spawns future `GameSession` rows on a schedule."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.session import GameSession


class SessionRecurrenceRule(Base):
    __tablename__ = "session_recurrence_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # IANA name, e.g. Europe/London — used with weekday + wall time below
    timezone: Mapped[str] = mapped_column(String, default="UTC")
    # Kickoff (meetup) wall time each week — Python weekday Monday=0 .. Sunday=6
    weekday: Mapped[int] = mapped_column(Integer)
    hour: Mapped[int] = mapped_column(Integer)
    minute: Mapped[int] = mapped_column(Integer)

    # When each week to create the next session + email join links (APScheduler cron in this TZ)
    announce_timezone: Mapped[str] = mapped_column(String, default="UTC")
    announce_weekday: Mapped[int] = mapped_column(Integer, default=0)
    announce_hour: Mapped[int] = mapped_column(Integer, default=9)
    announce_minute: Mapped[int] = mapped_column(Integer, default=0)

    location: Mapped[str] = mapped_column(String)
    fee: Mapped[float] = mapped_column(Float, default=0.0)
    min_players: Mapped[int] = mapped_column(Integer, default=10)
    max_players: Mapped[int] = mapped_column(Integer, default=15)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    waitlist_mode: Mapped[str] = mapped_column(String, default="auto_promote")
    #: Copied onto each materialized `GameSession` from this rule.
    team_assignment_mode: Mapped[str] = mapped_column(String, default="balanced")

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    sessions: Mapped[list[GameSession]] = relationship(
        "GameSession", back_populates="recurrence_rule"
    )
