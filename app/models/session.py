from datetime import datetime

from sqlalchemy import String, Integer, DateTime, ForeignKey, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.user import User
from app.models.chat import ChatMessage


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
