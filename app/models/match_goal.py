"""MatchGoal: one scored goal within a SessionMatch.

Goals are the source of truth; ``score_a`` / ``score_b`` on SessionMatch are
derived counters recomputed by COUNT on this table inside the same transaction
as every insert / soft-delete (plan §2.1). ``intent_id`` is the network-retry
idempotency key (plan §2.5); duplicate entry of the same event within 90 s is
rejected unless ``force`` is passed (plan §5 backstop).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.timeutil import utcnow


class MatchGoal(Base):
    __tablename__ = "match_goals"
    __table_args__ = (
        UniqueConstraint("intent_id", name="uq_match_goals_intent"),
        # Hard dedupe backstop (plan §3): two people cannot keep two LIVE rows
        # for the same (team, scorer, minute) event — but a soft-deleted goal
        # may be re-entered with the same key later (plan §8 "deleted then
        # re-added"), so the unique index covers live rows only
        # (deleted_at IS NULL). ``force`` bypasses only the 90 s window
        # *reply*; if a live row exists the endpoint replays it.
        Index(
            "uq_match_goals_dedupe",
            "match_id",
            "team",
            "clock_minute",
            "scorer_id",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("session_matches.id"), index=True)
    #: 'a' | 'b' — which team scored.
    team: Mapped[str] = mapped_column(String(1))
    scorer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    #: Exactly one assist, or none (plan §2.8).
    assist_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    #: Optional: the keeper who was in goal for the *conceding* team, i.e.
    #: always a member of the other team (never the scoring team). Optional
    #: because casual games rotate keepers mid-match and nobody wants to be
    #: blocked on getting it right — an unknown keeper stays empty.
    #: Powers per-keeper goals-conceded / clean-sheet stats later.
    goalkeeper_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    #: Remaining seconds on the server clock at the moment of entry.
    clock_secs: Mapped[int] = mapped_column(Integer)
    #: Minutes elapsed (1-based: first minute of play is 1'). Dedupe key part.
    clock_minute: Mapped[int] = mapped_column(Integer)
    #: Goal crossed the line after the final whistle — needs admin confirm.
    after_whistle: Mapped[bool] = mapped_column(Boolean, default=False)
    #: Account that entered the goal (may be a proxy device, plan §2.7).
    recorded_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    #: Client-minted idempotency key (UUID hex).
    intent_id: Mapped[str] = mapped_column(String, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    #: Soft delete — the per-row delete button (plan §2.9).
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
