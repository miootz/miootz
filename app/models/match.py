"""MeetupMatch: individual team-vs-team match within a Meetup."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.timeutil import utcnow

if TYPE_CHECKING:
    from app.models.meetup import Meetup


class MeetupMatch(Base):
    __tablename__ = "meetup_matches"
    # Two devices ending the same match must not both insert the "next"
    # match with the same number — the guarded UPDATE in end_match decides
    # the winner, this index is the hard backstop.
    __table_args__ = (
        UniqueConstraint("meetup_id", "match_number", name="uq_meetup_match_number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meetup_id: Mapped[int] = mapped_column(ForeignKey("meetups.id"), index=True)
    #: 1-based sequence within the meetup.
    match_number: Mapped[int] = mapped_column(Integer)

    # Team composition (user IDs stored as JSON text arrays)
    team_a_users: Mapped[str] = mapped_column(Text)  # JSON array of int user IDs
    team_b_users: Mapped[str] = mapped_column(Text)  # JSON array of int user IDs
    team_a_name: Mapped[str] = mapped_column(String)
    team_b_name: Mapped[str] = mapped_column(String)

    score_a: Mapped[int] = mapped_column(Integer, default=0)
    score_b: Mapped[int] = mapped_column(Integer, default=0)
    #: Manual referee correction layered on top of the goal COUNT
    #: (score = live_goal_count + offset), so +1/-1/set-score and goal
    #: entry compose instead of overwriting each other.
    score_offset_a: Mapped[int] = mapped_column(Integer, default=0)
    score_offset_b: Mapped[int] = mapped_column(Integer, default=0)

    #: "pending" | "active" | "time_up" | "completed"
    status: Mapped[str] = mapped_column(String, default="pending")

    # Timer
    #: Total match duration in seconds (from meetup.match_duration_minutes).
    timer_total_seconds: Mapped[int] = mapped_column(Integer, default=600)
    #: Server-authoritative remaining seconds.
    timer_seconds_remaining: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: ISO timestamps of pause intervals: JSON array of {"paused_at": iso, "resumed_at": iso | null}
    timer_pause_intervals: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: When the timer was started (UTC).
    timer_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    meetup: Mapped[Meetup] = relationship("Meetup")
