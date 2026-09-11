from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.core.timeutil import utcnow


class InviteToken(Base):
    __tablename__ = "invite_tokens"

    token: Mapped[str] = mapped_column(String, primary_key=True)
    first_name: Mapped[str] = mapped_column(String, default="", index=True)
    last_name: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used: Mapped[bool] = mapped_column(default=False)
    #: Pocket ID user UUID (sub) that claimed this invite
    pocket_id_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    #: miootz User ID this invite was created for (set when admin invites an existing user)
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
