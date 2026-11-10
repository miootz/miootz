from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class AuditBase(DeclarativeBase):
    """Separate declarative base so audit tables land in the audit DB,
    never in the main game database."""


class AuditLog(AuditBase):
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_category_created", "category", "created_at"),
        Index("ix_audit_log_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    #: Naive UTC (app-wide SQLite convention, see app.core.timeutil)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    username: Mapped[str | None] = mapped_column(String(120), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    category: Mapped[str] = mapped_column(String(32))
    #: Machine action name, e.g. "meetup.created"
    action: Mapped[str] = mapped_column(String(64))
    #: Human-friendly description of the effect
    description: Mapped[str] = mapped_column(Text)
    meetup_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
