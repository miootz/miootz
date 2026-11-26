from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    DateTime,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.user import User
from app.models.chat import ChatMessage
from app.core.timeutil import utcnow

if TYPE_CHECKING:
    from app.models.game_template import GameTemplate
    from app.models.match import MeetupMatch
    from app.models.rating import Rating


class Meetup(Base):
    __tablename__ = "meetups"
    __table_args__ = (
        # One materialized meetup per template kickoff instant (missed-week
        # backfill + concurrent pollers both race on the same slot).
        UniqueConstraint(
            "game_template_id", "start_time", name="uq_meetup_template_start"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    location: Mapped[str] = mapped_column(String)
    fee: Mapped[float] = mapped_column(Float, default=0.0)
    #: Free-text price label (e.g. "8 credits") shown instead of the numeric fee.
    fee_text: Mapped[str | None] = mapped_column(String, nullable=True)
    min_players: Mapped[int] = mapped_column(Integer, default=10)
    max_players: Mapped[int] = mapped_column(Integer, default=15)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    # broadcast: notify all waitlisted when a spot opens; first magic-link confirm wins
    # auto_promote: promote first in waitlist immediately when a confirmed spot opens
    waitlist_mode: Mapped[str] = mapped_column(String, default="auto_promote")
    #: auto-balanced = optimized skill draft; balanced = snake; random = shuffled snake.
    team_assignment_mode: Mapped[str] = mapped_column(String, default="auto-balanced")
    #: JSON list of lists of user ids per team (admin lineups); None = use algorithm on read.
    manual_teams_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Incremented when attendance, meetup fields, or other player-visible data changes.
    content_revision: Mapped[int] = mapped_column(Integer, default=0)
    #: Set when the 1-hour kickoff Web Push reminder has been sent (one per meetup).
    kickoff_reminder_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    #: Expected meetup length in minutes (used for end-time calculations, rating reminders).
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Set when the post-meetup rating reminder has been sent (one per meetup).
    rating_reminder_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    #: Match duration in minutes for live team-vs-team matches (copied from template).
    match_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: JSON array of team names generated at meetup creation (e.g. ["Team A", "Team B"]).
    team_names_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Upper bound on number of teams. When None, team count is purely algorithmic (≤10→2, 11–15→3).
    #: When set, the admin can expand/contract teams and waitlisted players are auto-promoted/returned.
    max_teams: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Selected players per team when an admin has set a team shape.
    team_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: The opening round was created simultaneously on two pitches.
    two_pitch: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    #: Admin skip: hidden from all listings and history (no trace). Undo = one-off
    #: meetup created at the same date via the standard create form.
    skipped: Mapped[bool] = mapped_column(Boolean, default=False)

    # ── Weather ────────────────────────────────────────────────────
    #: Cached forecast temperature (°C) for the meetup date.
    weather_forecast_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: WMO weather code for the forecast (0 = clear, 1-3 = cloudy, etc.).
    weather_forecast_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Human-readable label for the forecast (e.g. "Partly cloudy").
    weather_forecast_label: Mapped[str | None] = mapped_column(String, nullable=True)
    #: When the forecast was last fetched.
    weather_forecast_fetched_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    #: Actual temperature recorded at meetup end (°C).
    weather_actual_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: WMO weather code for actual conditions.
    weather_actual_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Human-readable label for actual conditions.
    weather_actual_label: Mapped[str | None] = mapped_column(String, nullable=True)
    #: When actual conditions were recorded.
    weather_actual_recorded_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )

    #: Source template when this meetup was created from a recurring template (nullable for one-offs).
    game_template_id: Mapped[int | None] = mapped_column(
        ForeignKey("game_templates.id"),
        nullable=True,
        index=True,
    )
    game_template: Mapped[GameTemplate | None] = relationship(
        "GameTemplate",
        back_populates="meetups",
    )

    attendees: Mapped[list[Attendance]] = relationship(
        "Attendance", back_populates="meetup", cascade="all, delete-orphan"
    )
    ratings: Mapped[list[Rating]] = relationship(
        "Rating", back_populates="meetup", cascade="all, delete-orphan"
    )
    messages: Mapped[list[ChatMessage]] = relationship(
        "ChatMessage", back_populates="meetup", cascade="all, delete-orphan"
    )
    scores: Mapped[list[MatchScore]] = relationship(
        "MatchScore", back_populates="meetup", cascade="all, delete-orphan"
    )
    matches: Mapped[list[MeetupMatch]] = relationship(
        "MeetupMatch", back_populates="meetup", cascade="all, delete-orphan"
    )


class MatchScore(Base):
    __tablename__ = "match_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meetup_id: Mapped[int] = mapped_column(ForeignKey("meetups.id"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    score: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String)

    meetup: Mapped[Meetup] = relationship("Meetup", back_populates="scores")
    player: Mapped[User] = relationship("User")


class Attendance(Base):
    __tablename__ = "attendance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meetup_id: Mapped[int] = mapped_column(ForeignKey("meetups.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # confirmed | waitlisted | cancelled
    status: Mapped[str] = mapped_column(String, default="confirmed")
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    previous_status: Mapped[str | None] = mapped_column(String, nullable=True)

    meetup: Mapped[Meetup] = relationship(
        "Meetup", back_populates="attendees"
    )
    user: Mapped[User] = relationship("User")
