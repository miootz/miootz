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
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meetup_id: Mapped[int] = mapped_column(ForeignKey("meetups.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    message: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    meetup: Mapped[Meetup] = relationship(
        "Meetup", back_populates="messages"
    )
    user: Mapped[User] = relationship("User")


class ChatReceipt(Base):
    """Last messages acknowledged and read by one user in one meetup.

    Message IDs are monotonic cursors, so deleting an individual message does
    not remove acknowledgement of the other messages in the conversation.
    """

    __tablename__ = "chat_receipts"

    meetup_id: Mapped[int] = mapped_column(ForeignKey("meetups.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    delivered_id: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    read_id: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
