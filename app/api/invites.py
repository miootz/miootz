import asyncio
import logging
import re
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
from app.services.ldap_invite_users import provision_ldap_invite_user
from app.services.smtp_mail import send_smtp_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/invites", tags=["invites"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


async def _send_invite_email(to_email: str, verify_url: str, expires_at: datetime) -> None:
    subj = "You're invited to Footy Legends"
    plain = (
        f"You've been invited to join Footy Legends.\n\n"
        f"Open this link to complete registration (one-time, expires {expires_at.isoformat(timespec='minutes')}):\n"
        f"{verify_url}\n\n"
        f"If you did not expect this, you can ignore this email."
    )
    html = (
        f"<p>You've been invited to join <strong>Footy Legends</strong>.</p>"
        f"<p><a href=\"{verify_url}\">Complete your registration</a></p>"
        f"<p style=\"color:#666;font-size:12px\">This link expires {expires_at.isoformat(timespec='minutes')}.</p>"
    )
    ok = await send_smtp_email(to_email, subj, plain, html)
    if not ok and (settings.SMTP_HOST or "").strip():
        logger.error("Invite email could not be sent to %s", to_email)


async def _send_welcome_email(
    to_email: str,
    *,
    authelia_username: str,
    password: str,
) -> None:
    portal = (settings.AUTH_PORTAL_URL or "").strip().rstrip("/")
    portal_line = f"\nSign in: {portal}\n" if portal else "\nUse your organization's Authelia sign-in page.\n"
    plain = (
        f"Your Footy Legends account is ready.\n\n"
        f"Username: {authelia_username}\n"
        f"Temporary password: {password}\n"
        f"{portal_line}"
        f"Sign in with the username and password above, then change your password in Authelia "
        f"(recommended).\n\n"
        f"The app will recognize you automatically after you sign in."
    )
    portal_html = (
        f'<p><a href="{portal}">Open sign-in</a></p>' if portal else ""
    )
    html = (
        f"<p>Your <strong>Footy Legends</strong> account is ready.</p>"
        f"<p><strong>Username:</strong> {authelia_username}<br/>"
        f"<strong>Temporary password:</strong> {password}</p>"
        f"{portal_html}"
        f"<p>Sign in and change your password in Authelia when prompted.</p>"
    )
    await send_smtp_email(
        to_email,
        "Your Footy Legends account is ready",
        plain,
        html,
    )


@router.post("/create")
async def create_invite(
    email: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    email = (email or "").strip()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email address")

    token = str(uuid.uuid4())
    expires_at = datetime.utcnow() + timedelta(days=7)

    invite = InviteToken(token=token, email=email, expires_at=expires_at)
    db.add(invite)
    await db.commit()

    base = settings.PUBLIC_APP_URL.rstrip("/")
    verify_path = f"/invites/verify/{token}"
    verify_url = f"{base}{verify_path}"

    await _send_invite_email(email, verify_url, expires_at)

    return {
        "invite_link": verify_url,
        "expires_at": expires_at.isoformat(),
    }


@router.get("/verify/{token}")
async def verify_invite(token: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InviteToken).where(InviteToken.token == token))
    invite = result.scalar_one_or_none()

    if not invite or invite.used or invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    existing = await db.execute(select(User).where(User.email == invite.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User already exists")

    try:
        authelia_username, temp_password = await asyncio.to_thread(
            provision_ldap_invite_user,
            email=invite.email,
            display_name=None,
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("LDAP provisioning failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail="Could not create SSO user. Try again or contact an admin.",
        ) from e

    user = User(username=authelia_username, email=invite.email)
    db.add(user)

    invite.used = True
    await db.commit()

    await _send_welcome_email(
        invite.email,
        authelia_username=authelia_username,
        password=temp_password,
    )

    return {
        "message": (
            "Registration complete. Check your email for your Authelia username and "
            "temporary password, then sign in."
        ),
        "username": authelia_username,
        "email": invite.email,
    }
