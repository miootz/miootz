import logging
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.invite import InviteToken
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/invites", tags=["invites"])


def _append_authelia_note(username: str, email: str) -> None:
    path = (settings.AUTHELIA_USERS_YML_PATH or "").strip()
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(
                f"\n# Footy invite pending: username={username!r} email={email!r} "
                "# Add this user to Authelia (file/LDAP/OIDC).\n"
            )
    except OSError as e:
        logger.warning("Could not append Authelia note: %s", e)


@router.post("/create")
async def create_invite(
    email: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    token = str(uuid.uuid4())
    expires_at = datetime.utcnow() + timedelta(days=7)

    invite = InviteToken(token=token, email=email, expires_at=expires_at)
    db.add(invite)
    await db.commit()

    base = settings.PUBLIC_APP_URL.rstrip("/")
    return {
        "invite_link": f"{base}/invites/verify/{token}",
        "expires_at": expires_at.isoformat(),
    }


@router.get("/verify/{token}")
async def verify_invite(token: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InviteToken).where(InviteToken.token == token))
    invite = result.scalar_one_or_none()

    if not invite or invite.used or invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    username = invite.email.split("@")[0]
    existing = await db.execute(select(User).where(User.email == invite.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User already exists")

    user = User(username=username, email=invite.email)
    db.add(user)

    invite.used = True
    await db.commit()

    _append_authelia_note(username, invite.email)

    return {
        "message": (
            "User created locally. Complete activation in Authelia (OIDC / admin) "
            "using the same email."
        ),
        "username": username,
        "email": invite.email,
    }
