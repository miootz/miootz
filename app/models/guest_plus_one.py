"""Plus-one guest attendance reservations.

When a confirmed attendee adds a plus-one, a placeholder User is created
and an Attendance row links them to the session.  The GuestPlusOne record
holds the claim token so the guest can later claim the account.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.timeutil import utcnow

if TYPE_CHECKING:
    from app.models.session import GameSession
    from app.models.user import User


class GuestPlusOne(Base):
    __tablename__ = "guest_plus_ones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    #: Session the guest is attending.
    session_id: Mapped[int] = mapped_column(ForeignKey("game_sessions.id"), index=True)
    session: Mapped[GameSession] = relationship("GameSession")

    #: User who invited the guest.
    inviter_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    inviter: Mapped[User] = relationship("User", foreign_keys=[inviter_id])

    #: Placeholder User created for the guest (before claim).
    guest_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    guest_user: Mapped[User] = relationship(
        "User", foreign_keys=[guest_user_id], backref="guest_plus_one"
    )

    #: Guest's display name (provided by inviter).
    first_name: Mapped[str] = mapped_column(String)
    last_name: Mapped[str] = mapped_column(String)

    #: Guest's self-assessed skill (1–5, provided by inviter).
    self_assessed_skill: Mapped[int] = mapped_column(Integer)

    #: Unique claim token (shared via link/SMS).
    claim_token: Mapped[str] = mapped_column(String, unique=True, index=True)

    #: "pending" → guest hasn't claimed yet; "claimed" → guest claimed the account.
    status: Mapped[str] = mapped_column(String, default="pending")

    #: User who claimed this plus-one (set on claim; may differ from guest_user
    #: if the guest already had an account and we merged).
    claimed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    claimed_by_user: Mapped[User | None] = relationship(
        "User", foreign_keys=[claimed_by_user_id]
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
