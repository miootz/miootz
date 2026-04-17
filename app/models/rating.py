from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.user import User


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "rater_id",
            "ratee_id",
            name="uq_rating_session_rater_ratee",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("game_sessions.id"), index=True)
    rater_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    ratee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    score: Mapped[int] = mapped_column(Integer)  # 1-5
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped["GameSession"] = relationship(
        "GameSession", back_populates="ratings"
    )
    rater: Mapped["User"] = relationship("User", foreign_keys=[rater_id])
    ratee: Mapped["User"] = relationship("User", foreign_keys=[ratee_id])
