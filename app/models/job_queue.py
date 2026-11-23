"""Durable one-shot job queue (SQLite-backed, survives restarts)."""

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class JobQueue(Base):
    """One row per (job_type, ref_id); run_at is naive UTC like the rest of the DB."""

    __tablename__ = "job_queue"
    __table_args__ = (
        UniqueConstraint("job_type", "ref_id", name="uq_job_queue_type_ref"),
        Index("ix_job_queue_run_at", "run_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_type: Mapped[str] = mapped_column(String, nullable=False)
    ref_id: Mapped[int] = mapped_column(Integer, nullable=False)
    run_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    claimed_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
