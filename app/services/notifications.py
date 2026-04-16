import logging
from datetime import datetime, timezone
from typing import Iterable

import httpx

from app.core.config import settings
from app.models.session import GameSession
from app.models.user import User
from app.services.magic_links import sign_action_token

logger = logging.getLogger(__name__)


def _session_expiry_ts(session: GameSession) -> float:
    st = session.start_time
    if st.tzinfo is None:
        st = st.replace(tzinfo=timezone.utc)
    return st.timestamp()


def build_action_urls(session: GameSession, user: User) -> dict[str, str]:
    """SPA opens /session-action?t=…; token embeds confirm | cancel | reactivate."""
    base = settings.PUBLIC_APP_URL.rstrip("/")
    exp = _session_expiry_ts(session)
    q = lambda act: f"{base}/session-action?t={sign_action_token(session.id, user.id, act, exp)}"
    return {
        "confirm": q("confirm"),
        "cancel": q("cancel"),
        "reactivate": q("reactivate"),
    }


async def send_mailgun_email(to_email: str, subject: str, text_body: str) -> bool:
    if not settings.MAILGUN_API_KEY or not settings.MAILGUN_DOMAIN:
        logger.warning("Mailgun not configured; skipping email to %s", to_email)
        return False

    auth = ("api", settings.MAILGUN_API_KEY)
    data = {
        "from": settings.MAIL_FROM,
        "to": to_email,
        "subject": subject,
        "text": text_body,
    }
    url = f"https://api.mailgun.net/v3/{settings.MAILGUN_DOMAIN}/messages"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(url, auth=auth, data=data)
        if r.status_code >= 400:
            logger.error("Mailgun error %s: %s", r.status_code, r.text)
            return False
    return True


async def send_gotify_notification(title: str, message: str) -> bool:
    if not settings.GOTIFY_URL or not settings.GOTIFY_APP_TOKEN:
        logger.debug("Gotify not configured; skip push")
        return False

    url = f"{settings.GOTIFY_URL.rstrip('/')}/message"
    params = {"token": settings.GOTIFY_APP_TOKEN}
    data = {"title": title, "message": message, "priority": 5}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(url, params=params, data=data)
        if r.status_code >= 400:
            logger.error("Gotify error %s: %s", r.status_code, r.text)
            return False
    return True


def format_session_summary(session: GameSession) -> str:
    when = session.start_time
    if isinstance(when, datetime):
        when = when.isoformat(timespec="minutes")
    return f"{when} @ {session.location} (fee: {session.fee})"


async def notify_new_recurring_session_invites(
    session: GameSession, recipients: Iterable[User]
) -> None:
    """New session from weekly rule — personalized confirm/cancel links."""
    summary = format_session_summary(session)
    emailed = 0
    for user in recipients:
        if not user.email:
            continue
        urls = build_action_urls(session, user)
        body = (
            f"A new meetup was added to the schedule:\n{summary}\n\n"
            f"Confirm: {urls['confirm']}\n"
            f"Cancel: {urls['cancel']}\n"
        )
        if await send_mailgun_email(
            user.email,
            subject=f"Footy: new session — {session.location}",
            text_body=body,
        ):
            emailed += 1
    if emailed:
        await send_gotify_notification(
            "New recurring session",
            f"{summary}\n({emailed} emails sent)",
        )


async def notify_broadcast_spot_open(
    session: GameSession, waitlisted_users: list[User]
) -> None:
    """When a spot opens in broadcast mode, email all waitlisted players."""
    summary = format_session_summary(session)
    emailed = 0
    for user in waitlisted_users:
        if not user.email:
            continue
        urls = build_action_urls(session, user)
        body = (
            f"A spot opened — first to confirm gets it:\n{summary}\n\n"
            f"Confirm: {urls['confirm']}\n"
        )
        if await send_mailgun_email(
            user.email,
            subject=f"Footy: spot available — {session.location}",
            text_body=body,
        ):
            emailed += 1
    if emailed:
        await send_gotify_notification(
            "Spot available",
            f"{summary} — {emailed} players notified by email.",
        )


async def notify_auto_promoted(session: GameSession, user: User) -> None:
    if not user.email:
        return
    urls = build_action_urls(session, user)
    body = (
        f"You have been promoted from the waitlist:\n"
        f"{format_session_summary(session)}\n\n"
        f"Confirm: {urls['confirm']}\nCancel: {urls['cancel']}\n"
    )
    await send_mailgun_email(
        user.email,
        subject=f"Footy: you're in — {session.location}",
        text_body=body,
    )
