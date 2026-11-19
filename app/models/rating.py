from datetime import datetime
from typing import TYPE_CHECKING, Literal

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.user import User
from app.core.timeutil import utcnow

if TYPE_CHECKING:
    from app.models.meetup import Meetup

PeerReview = Literal["poorly", "expected", "well", "excellent"]
PEER_REVIEW_ADJUSTMENTS: dict[PeerReview, float] = {
    "poorly": -1.0,
    "expected": 0.0,
    "well": 0.5,
    "excellent": 1.0,
}


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
    # Absolute stars for older votes. Emoji reviews use 3 + adjustment in summaries.
    score: Mapped[float] = mapped_column(Float)
    review: Mapped[PeerReview | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    meetup: Mapped[Meetup] = relationship("Meetup", back_populates="ratings")
    rater: Mapped[User] = relationship("User", foreign_keys=[rater_id])
    ratee: Mapped[User] = relationship("User", foreign_keys=[ratee_id])
