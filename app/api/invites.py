import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.responses import Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.invite import InviteToken
from app.models.user import User
from app.services.authelia_login import authelia_first_factor_login
from app.services.ldap_invite_users import ldap_replace_user_password, provision_ldap_invite_user
from app.services.smtp_mail import send_smtp_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/invites", tags=["invites"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_INVITE_SETUP_SALT = "invite-password-setup"
_MIN_PASSWORD_LEN = 10


def _invite_setup_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.SECRET_KEY, salt=_INVITE_SETUP_SALT)


def _post_login_app_url() -> str:
    return settings.PUBLIC_APP_URL.rstrip("/") + "/"


def _fallback_portal_redirect() -> str:
    portal = (settings.AUTH_PORTAL_URL or "").strip().rstrip("/")
    home = _post_login_app_url()
    if portal:
        return f"{portal}/?rd={quote(home, safe='')}"
    return home


def _validate_new_password(password: str, password_confirm: str) -> None:
    if password != password_confirm:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if len(password) < _MIN_PASSWORD_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {_MIN_PASSWORD_LEN} characters",
        )


async def _send_invite_email(to_email: str, verify_url: str, expires_at: datetime) -> None:
    subj = "You're invited to Footy Legends"
    plain = (
        f"You've been invited to join Footy Legends.\n\n"
        f"Open this link to choose your password and sign in (one-time, expires {expires_at.isoformat(timespec='minutes')}):\n"
        f"{verify_url}\n\n"
        f"If you did not expect this, you can ignore this email."
    )
    html = (
        f"<p>You've been invited to join <strong>Footy Legends</strong>.</p>"
        f"<p><a href=\"{verify_url}\">Choose your password and join</a></p>"
        f"<p style=\"color:#666;font-size:12px\">This link expires {expires_at.isoformat(timespec='minutes')}.</p>"
    )
    ok = await send_smtp_email(to_email, subj, plain, html)
    if not ok and (settings.SMTP_HOST or "").strip():
        logger.error("Invite email could not be sent to %s", to_email)


class InviteVerifyBeginBody(BaseModel):
    token: str = Field(..., min_length=1)


class InviteVerifyCompleteBody(BaseModel):
    setup_token: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    password_confirm: str = Field(..., min_length=1)


@router.get("/admin/list")
async def list_invites_admin(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List invite tokens for the admin UI (newest first)."""
    result = await db.execute(
        select(InviteToken)
        .order_by(desc(InviteToken.created_at))
        .offset(offset)
        .limit(limit)
    )
    rows = result.scalars().all()
    base = settings.PUBLIC_APP_URL.rstrip("/")
    return [
        {
            "token": r.token,
            "email": r.email,
            "created_at": r.created_at.isoformat(),
            "expires_at": r.expires_at.isoformat(),
            "used": r.used,
            "invite_link": f"{base}/invites/verify/{r.token}",
        }
        for r in rows
    ]


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
async def invite_verify_get_removed(token: str):
    """Legacy clients used GET here; registration is now ``begin`` + ``complete`` (POST only)."""
    _ = token
    raise HTTPException(
        status_code=405,
        detail=(
            "Use POST /invites/verify/begin with JSON body {\"token\": \"...\"}, "
            "then POST /invites/verify/complete with setup_token and password."
        ),
        headers={"Allow": "POST"},
    )


@router.post("/verify/begin")
async def invite_verify_begin(body: InviteVerifyBeginBody, db: AsyncSession = Depends(get_db)):
    """
    Validate the invite token, provision LDAP + database user, mark the invite used.

    Returns a short-lived ``setup_token`` for ``invite_verify_complete``.
    """
    token = body.token.strip()
    result = await db.execute(select(InviteToken).where(InviteToken.token == token))
    invite = result.scalar_one_or_none()

    if not invite or invite.used or invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    existing = await db.execute(select(User).where(User.email == invite.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User already exists")

    try:
        authelia_username, _temp_password = await asyncio.to_thread(
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

    setup_token = _invite_setup_serializer().dumps({"u": authelia_username})

    return {
        "username": authelia_username,
        "email": invite.email,
        "setup_token": setup_token,
    }


@router.post("/verify/complete")
async def invite_verify_complete(body: InviteVerifyCompleteBody, db: AsyncSession = Depends(get_db)):
    """
    Apply the user's chosen LDAP password, then perform Authelia first-factor via the
    internal Authelia URL so session cookies can be forwarded to the browser.
    """
    _validate_new_password(body.password, body.password_confirm)

    try:
        data = _invite_setup_serializer().loads(body.setup_token, max_age=900)
    except SignatureExpired:
        raise HTTPException(
            status_code=400,
            detail="Setup session expired. Ask an admin for a new invite.",
        ) from None
    except BadSignature:
        raise HTTPException(status_code=400, detail="Invalid setup session.") from None

    username = data.get("u") if isinstance(data, dict) else None
    if not username or not isinstance(username, str):
        raise HTTPException(status_code=400, detail="Invalid setup session.")

    result = await db.execute(select(User).where(User.username == username))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=400, detail="Unknown user")

    try:
        await asyncio.to_thread(
            ldap_replace_user_password,
            uid=username,
            plaintext=body.password,
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("LDAP password update failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail="Could not set password. Try again or contact an admin.",
        ) from e

    home = _post_login_app_url()
    internal = (settings.AUTHELIA_INTERNAL_URL or "").strip()

    if internal:
        try:
            cookies, redir = await authelia_first_factor_login(
                internal_base_url=internal,
                username=username,
                password=body.password,
                target_url=home,
            )
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e)) from e
        final = redir or home
        resp = Response(
            content=json.dumps({"redirect": final, "username": username}),
            media_type="application/json",
        )
        for c in cookies:
            resp.raw_headers.append((b"set-cookie", c.encode("latin-1")))
        return resp

    return {
        "redirect": _fallback_portal_redirect(),
        "username": username,
        "manual_login": True,
    }
