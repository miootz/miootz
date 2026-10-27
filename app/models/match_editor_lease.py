"""MatchEditorLease: ONE row per match — THE serialization point.

Acquiring is a single atomic UPDATE guarded by
``holder_id IS NULL OR expires_at <= now`` (the row itself is created lazily
with INSERT OR IGNORE); ``rowcount == 0`` means somebody else holds it.
Correct on SQLite (whose writers are serialised anyway) and still correct if
the backend moves to Postgres (plan §3).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.timeutil import utcnow


class MatchEditorLease(Base):
    __tablename__ = "match_editor_lease"

    match_id: Mapped[int] = mapped_column(
        ForeignKey("meetup_matches.id"), primary_key=True
    )
    #: NULL = free. Only the holder may renew/release (token checked).
    holder_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    acquired_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    #: Lease is free once this timestamp passes (45 s TTL, renewable).
    expires_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    #: Opaque token returned on acquire; must be echoed to renew/release.
    release_token: Mapped[str] = mapped_column(String, default="")
