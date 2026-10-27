from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.user import User
from app.core.timeutil import utcnow

if TYPE_CHECKING:
    from app.models.meetup import Meetup


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (
        UniqueConstraint(
            "meetup_id",
            "rater_id",
            "ratee_id",
            name="uq_rating_meetup_rater_ratee",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meetup_id: Mapped[int] = mapped_column(ForeignKey("meetups.id"), index=True)
    rater_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    ratee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    score: Mapped[int] = mapped_column(Integer)  # 1-5
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    meetup: Mapped[Meetup] = relationship("Meetup", back_populates="ratings")
    rater: Mapped[User] = relationship("User", foreign_keys=[rater_id])
    ratee: Mapped[User] = relationship("User", foreign_keys=[ratee_id])
