from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MeetupSignupHold(Base):
    __tablename__ = "meetup_signup_holds"
    __table_args__ = (UniqueConstraint("meetup_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    meetup_id: Mapped[int] = mapped_column(ForeignKey("meetups.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    started_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    settled: Mapped[bool] = mapped_column(default=False)
