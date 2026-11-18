"""MatchGoal: one scored goal within a MeetupMatch.

Goals are the source of truth; ``score_a`` / ``score_b`` on MeetupMatch are
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
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.timeutil import utcnow


class MatchGoal(Base):
    __tablename__ = "match_goals"
    __table_args__ = (
        UniqueConstraint("intent_id", name="uq_match_goals_intent"),
        # No hard unique index on (match, team, minute, scorer): a striker can
        # score twice in the same minute. The 90 s soft check in create_goal
        # is the dedupe backstop — it returns 409 (or replays after 90 s) and
        # an explicit ``force`` confirms a genuine second goal as a new row.
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("meetup_matches.id"), index=True)
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
    #: Own goal: the scorer is a member of the *conceding* team. The goal
    #: still counts toward ``team``'s score (the team that benefited).
    is_own_goal: Mapped[bool] = mapped_column(Boolean, default=False)
    #: A scored penalty during regulation, separate from shootout kicks.
    is_penalty: Mapped[bool] = mapped_column(Boolean, default=False)
    #: Account that entered the goal (may be a proxy device, plan §2.7).
    recorded_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    #: Client-minted idempotency key (UUID hex).
    intent_id: Mapped[str] = mapped_column(String, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    #: Soft delete — the per-row delete button (plan §2.9).
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
