"""GameTemplate: recurring meetup definition; materialized rows are `Meetup` instances."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.game_template_subscription import GameTemplateSubscription
    from app.models.meetup import Meetup


class GameTemplate(Base):
    __tablename__ = "game_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    #: Short label for admin/member UI (e.g. "Saturday kickabout").
    name: Mapped[str] = mapped_column(String, default="Meetup")

    # IANA name, e.g. Europe/London — used with weekday + wall time below
    timezone: Mapped[str] = mapped_column(String, default="UTC")
    # Kickoff (meetup) wall time each week — Python weekday Monday=0 .. Sunday=6
    weekday: Mapped[int] = mapped_column(Integer)
    hour: Mapped[int] = mapped_column(Integer)
    minute: Mapped[int] = mapped_column(Integer)

    # When each week to create the next meetup + notify subscribers (APScheduler cron in this TZ)
    announce_timezone: Mapped[str] = mapped_column(String, default="UTC")
    announce_weekday: Mapped[int] = mapped_column(Integer, default=0)
    announce_hour: Mapped[int] = mapped_column(Integer, default=12)
    announce_minute: Mapped[int] = mapped_column(Integer, default=0)

    location: Mapped[str] = mapped_column(String)
    fee: Mapped[float] = mapped_column(Float, default=0.0)
    #: Free-text price label (e.g. "8 credits") copied onto materialized meetups.
    fee_text: Mapped[str | None] = mapped_column(String, nullable=True)
    min_players: Mapped[int] = mapped_column(Integer, default=10)
    max_players: Mapped[int] = mapped_column(Integer, default=15)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    waitlist_mode: Mapped[str] = mapped_column(String, default="auto_promote")
    #: Copied onto each materialized `Meetup` from this template.
    team_assignment_mode: Mapped[str] = mapped_column(String, default="balanced")

    #: When False, scheduled jobs do not create new meetups for this template.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    #: Default match duration in minutes for live team-vs-team matches.
    match_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: When True, a 0-0 style tie is additionally recorded as a draw for
    #: statistics. Either way the away team takes the de-facto win (the home
    #: side must win to stay on the pitch).
    allows_draws: Mapped[bool] = mapped_column(Boolean, default=False)

    meetups: Mapped[list[Meetup]] = relationship(
        "Meetup", back_populates="game_template"
    )
    subscriptions: Mapped[list[GameTemplateSubscription]] = relationship(
        "GameTemplateSubscription",
        back_populates="game_template",
        cascade="all, delete-orphan",
    )
