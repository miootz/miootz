from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, Integer, DateTime, ForeignKey, Float, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.user import User
from app.models.chat import ChatMessage

if TYPE_CHECKING:
    from app.models.game_template import GameTemplate


class GameSession(Base):
    __tablename__ = "game_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    location: Mapped[str] = mapped_column(String)
    fee: Mapped[float] = mapped_column(Float, default=0.0)
    min_players: Mapped[int] = mapped_column(Integer, default=10)
    max_players: Mapped[int] = mapped_column(Integer, default=15)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    # broadcast: notify all waitlisted when a spot opens; first magic-link confirm wins
    # auto_promote: promote first in waitlist immediately when a confirmed spot opens
    waitlist_mode: Mapped[str] = mapped_column(
        String, default="auto_promote"
    )
    #: balanced = skill snake draft; random = shuffled snake (same team sizes)
    team_assignment_mode: Mapped[str] = mapped_column(String, default="balanced")
    #: JSON list of lists of user ids per team (admin lineups); None = use algorithm on read.
    manual_teams_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Incremented when attendance, session fields, or other player-visible data changes.
    content_revision: Mapped[int] = mapped_column(Integer, default=0)
    #: Set when the 1-hour kickoff Web Push reminder has been sent (one per session).
    kickoff_reminder_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )

    #: Source template when this session was created from a recurring template (nullable for one-offs).
    game_template_id: Mapped[int | None] = mapped_column(
        ForeignKey("game_templates.id"),
        nullable=True,
        index=True,
    )
    game_template: Mapped["GameTemplate | None"] = relationship(
        "GameTemplate",
        back_populates="sessions",
    )

    attendees: Mapped[list["Attendance"]] = relationship(
        "Attendance", back_populates="session", cascade="all, delete-orphan"
    )
    ratings: Mapped[list["Rating"]] = relationship(
        "Rating", back_populates="session", cascade="all, delete-orphan"
    )
    messages: Mapped[list["ChatMessage"]] = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan"
    )
    scores: Mapped[list["MatchScore"]] = relationship(
        "MatchScore", back_populates="session", cascade="all, delete-orphan"
    )


class MatchScore(Base):
    __tablename__ = "match_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("game_sessions.id"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    score: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String)

    session: Mapped["GameSession"] = relationship(
        "GameSession", back_populates="scores"
    )
    player: Mapped["User"] = relationship("User")


class Attendance(Base):
    __tablename__ = "attendance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("game_sessions.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # confirmed | waitlisted | cancelled
    status: Mapped[str] = mapped_column(String, default="confirmed")
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    previous_status: Mapped[str | None] = mapped_column(String, nullable=True)

    session: Mapped["GameSession"] = relationship(
        "GameSession", back_populates="attendees"
    )
    user: Mapped["User"] = relationship("User")
