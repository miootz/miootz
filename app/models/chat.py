from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.core.timeutil import utcnow

if TYPE_CHECKING:
    from app.models.meetup import Meetup
    from app.models.user import User


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meetup_id: Mapped[int] = mapped_column(ForeignKey("meetups.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    message: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    meetup: Mapped[Meetup] = relationship(
        "Meetup", back_populates="messages"
    )
    user: Mapped[User] = relationship("User")
