import asyncio
import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.session import Attendance, GameSession
from app.models.web_push_subscription import WebPushSubscription

logger = logging.getLogger(__name__)


def _payload(title: str, body: str) -> str:
    return json.dumps({"title": title, "body": body})


def _send_one(sub: WebPushSubscription, data: str) -> None:
    subscription_info = {
        "endpoint": sub.endpoint,
        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
    }
    webpush(
        subscription_info=subscription_info,
        data=data,
        vapid_private_key=settings.VAPID_PRIVATE_KEY,
        vapid_claims={"sub": settings.VAPID_SUBJECT},
    )


def _is_subscription_gone(exc: WebPushException) -> bool:
    resp = getattr(exc, "response", None)
    if resp is None:
        return False
    return resp.status_code in (404, 410)


async def _send_push_to_users(db: AsyncSession, user_ids: set[int], data: str) -> None:
    if not user_ids:
        return
    dead_ids: list[int] = []
    for uid in user_ids:
        subs = (
            await db.execute(
                select(WebPushSubscription).where(WebPushSubscription.user_id == uid)
            )
        ).scalars().all()
        for sub in subs:
            try:
                await asyncio.to_thread(_send_one, sub, data)
            except WebPushException as e:
                logger.debug("webpush fail uid=%s sub=%s: %s", uid, sub.id, e)
                if _is_subscription_gone(e):
                    dead_ids.append(sub.id)
            except Exception as e:
                logger.warning("webpush error uid=%s sub=%s: %s", uid, sub.id, e)

    if dead_ids:
        await db.execute(
            delete(WebPushSubscription).where(WebPushSubscription.id.in_(dead_ids))
        )
        await db.commit()


async def notify_session_chat_recipients(
    db: AsyncSession,
    session_id: int,
    sender_user_id: int,
    sender_username: str,
    message_preview: str,
) -> None:
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    r = await db.execute(
        select(Attendance.user_id).where(
            Attendance.session_id == session_id,
            Attendance.user_id != sender_user_id,
            Attendance.status != "cancelled",
        )
    )
    user_ids = {row[0] for row in r.all()}
    if not user_ids:
        return

    title = "Footy Legends chat"
    body = f"{sender_username}: {message_preview[:200]}"
    data = _payload(title, body)
    await _send_push_to_users(db, user_ids, data)


async def notify_session_cancelled_recipients(
    db: AsyncSession,
    session: GameSession,
) -> None:
    """Notify all non-cancelled attendees that an admin removed the meetup."""
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    r = await db.execute(
        select(Attendance.user_id).where(
            Attendance.session_id == session.id,
            Attendance.status != "cancelled",
        )
    )
    user_ids = {row[0] for row in r.all()}
    if not user_ids:
        return

    loc = (session.location or "Meetup")[:120]
    title = "Session cancelled"
    body = f"{loc} — this meetup was removed from the schedule."
    data = _payload(title, body)
    await _send_push_to_users(db, user_ids, data)


async def notify_kickoff_reminder_for_session(
    db: AsyncSession,
    session: GameSession,
) -> None:
    """Notify all non-cancelled attendees that kickoff is in about one hour."""
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    r = await db.execute(
        select(Attendance.user_id).where(
            Attendance.session_id == session.id,
            Attendance.status != "cancelled",
        )
    )
    user_ids = {row[0] for row in r.all()}
    if not user_ids:
        return

    loc = (session.location or "Meetup")[:120]
    title = "Kickoff in 1 hour"
    body = f"{loc} — see you at the pitch!"
    data = _payload(title, body)
    await _send_push_to_users(db, user_ids, data)
