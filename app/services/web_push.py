import asyncio
import json
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from pywebpush import WebPushException, webpush
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.meetup import Attendance, Meetup
from app.models.chat import ChatMessage, ChatReceipt
from app.models.user import User
from app.models.user_notification_preference import UserNotificationPreference
from app.models.web_push_subscription import WebPushSubscription
from app.services.meetup_signup import signup_hold_token
from app.services.peer_rating_policy import teammate_pairs
from app.services.rating_settings import get_rating_settings

logger = logging.getLogger(__name__)

_MAX_CONCURRENT_PUSH_SENDS = 10
_push_executor = ThreadPoolExecutor(
    max_workers=_MAX_CONCURRENT_PUSH_SENDS, thread_name_prefix="web-push"
)


# ── helpers ──────────────────────────────────────────────────────────


def _payload(
    title: str,
    body: str,
    url: str | None = None,
    actions: list[dict] | None = None,
    *,
    tag: str | None = None,
    message_id: int | None = None,
) -> str:
    """Build a JSON push payload the service worker can parse.

    ``actions`` is a list of dicts with keys:
        action  - internal action id (e.g. "confirm", "cancel")
        title   - label shown on the button
        url     - deep-link URL the PWA opens when the button is tapped
    """
    return json.dumps(
        {
            "title": title,
            "body": body,
            "url": url,
            "actions": actions or [],
            **({"tag": tag} if tag else {}),
            **({"message_id": message_id} if message_id is not None else {}),
        }
    )


def _action(
    action: str,
    title: str,
    meetup: Meetup,
) -> dict:
    """Build a single action button that deep-links into the PWA."""
    base = settings.PUBLIC_APP_URL.rstrip("/")
    return {
        "action": action,
        "title": title,
        "url": f"{base}/meetup-action?mid={meetup.id}&act={action}",
    }


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
        timeout=10,
    )


def _is_subscription_gone(exc: WebPushException) -> bool:
    resp = getattr(exc, "response", None)
    if resp is None:
        return False
    return resp.status_code in (404, 410)


def _format_meetup_summary(meetup: Meetup) -> str:
    from datetime import datetime

    when = meetup.start_time
    if isinstance(when, datetime):
        when = when.isoformat(timespec="minutes")
    return f"{when} @ {meetup.location} (fee: {meetup.fee_text or meetup.fee})"


async def _send_push_to_users(
    db: AsyncSession,
    user_ids: set[int],
    data: str | Callable[[int], str],
    category: str | None = None,
) -> dict[str, int]:
    """Send push notification to users, optionally filtering by preference category."""
    counts = {"sent": 0, "failed": 0, "expired": 0}
    if not user_ids:
        return counts

    query = select(WebPushSubscription).where(WebPushSubscription.user_id.in_(user_ids))
    if category:
        opted_out = select(UserNotificationPreference.id).where(
            UserNotificationPreference.user_id == WebPushSubscription.user_id,
            UserNotificationPreference.category == category,
            UserNotificationPreference.enabled.is_(False),
        )
        query = query.where(~opted_out.exists())
    subs = (await db.execute(query)).scalars().all()

    dead_ids: list[int] = []
    remaining = iter(subs)

    async def send_remaining() -> None:
        for sub in remaining:
            try:
                await asyncio.get_running_loop().run_in_executor(
                    _push_executor, _send_one, sub, data(sub.user_id) if callable(data) else data
                )
                counts["sent"] += 1
            except WebPushException as e:
                logger.debug("webpush fail uid=%s sub=%s: %s", sub.user_id, sub.id, e)
                if _is_subscription_gone(e):
                    dead_ids.append(sub.id)
                    counts["expired"] += 1
                else:
                    counts["failed"] += 1
            except Exception as e:
                logger.warning("webpush error uid=%s sub=%s: %s", sub.user_id, sub.id, e)
                counts["failed"] += 1

    await asyncio.gather(
        *(send_remaining() for _ in range(min(len(subs), _MAX_CONCURRENT_PUSH_SENDS)))
    )

    if dead_ids:
        await db.execute(
            delete(WebPushSubscription).where(WebPushSubscription.id.in_(dead_ids))
        )
        await db.commit()
    return counts


# ── notification functions ───────────────────────────────────────────


async def send_test_push(db: AsyncSession, user_id: int) -> dict[str, int]:
    return await _send_push_to_users(
        db,
        {user_id},
        _payload(
            title="Miootz test notification",
            body="This device can receive Miootz notifications.",
            url="/admin/tools",
        ),
    )


async def notify_new_meetup_invites(
    db: AsyncSession,
    meetup: Meetup,
    recipients: list[User],
) -> None:
    """Announce sign-ups; tapping the notification or Join opens the join flow."""
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    summary = _format_meetup_summary(meetup)
    user_ids: set[int] = {u.id for u in recipients if u.id}
    if not user_ids:
        return

    loc = (meetup.location or "Meetup")[:80]
    def payload(user_id: int) -> str:
        token = signup_hold_token(meetup, user_id)
        path = f"/meetup-reservation#hold={token}"
        return _payload(
            title="Miootz: new meetup",
            body=f"{loc} — {summary}",
            url=path,
            actions=[
                {"action": "join", "title": "Join", "url": f"{settings.PUBLIC_APP_URL.rstrip('/')}{path}"},
                _action("ignore", "Ignore", meetup),
            ],
        )
    await _send_push_to_users(db, user_ids, payload, category="meetup_invite")


async def notify_broadcast_spot_open(
    db: AsyncSession,
    meetup: Meetup,
    waitlisted_users: list[User],
) -> None:
    """When a spot opens in broadcast mode, push all waitlisted players a Confirm action."""
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    user_ids: set[int] = {u.id for u in waitlisted_users if u.id}
    if not user_ids:
        return

    loc = (meetup.location or "Meetup")[:80]
    data = _payload(
        title="Miootz: spot available",
        body=f"First to confirm gets it — {loc}",
        url=f"/meetups/{meetup.id}",
        actions=[
            _action("join", "Confirm", meetup),
        ],
    )
    await _send_push_to_users(db, user_ids, data, category="waitlist")


async def notify_auto_promoted(
    db: AsyncSession,
    meetup: Meetup,
    user: User,
) -> None:
    """Push the user who was auto-promoted from the waitlist."""
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    loc = (meetup.location or "Meetup")[:80]
    data = _payload(
        title="Miootz: you're in!",
        body=f"Promoted from waitlist — {loc}",
        url=f"/meetups/{meetup.id}",
        actions=[
            _action("view", "View", meetup),
        ],
    )
    await _send_push_to_users(db, {user.id}, data, category="waitlist")


async def notify_demoted_to_waitlist(
    db: AsyncSession,
    meetup: Meetup,
    user: User,
) -> None:
    """Push a player demoted to the waitlist by a Weather Hero redemption."""
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    loc = (meetup.location or "Meetup")[:80]
    data = _payload(
        title="Miootz: back to the waitlist",
        body=f"A Weather Hero took your spot — {loc}",
        url=f"/meetups/{meetup.id}",
        actions=[
            _action("view", "View", meetup),
        ],
    )
    await _send_push_to_users(db, {user.id}, data, category="waitlist")


async def notify_meetup_chat_recipients(
    db: AsyncSession,
    message: ChatMessage,
) -> None:
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    r = await db.execute(
        select(Attendance.user_id)
        .outerjoin(
            ChatReceipt,
            and_(
                ChatReceipt.meetup_id == Attendance.meetup_id,
                ChatReceipt.user_id == Attendance.user_id,
            ),
        )
        .where(
            Attendance.meetup_id == message.meetup_id,
            Attendance.user_id != message.user_id,
            Attendance.status.in_(("confirmed", "waitlisted", "cancelled")),
            Attendance.joined_at <= message.created_at,
            or_(ChatReceipt.read_id.is_(None), ChatReceipt.read_id < message.id),
        )
    )
    user_ids = {row[0] for row in r.all()}
    if not user_ids:
        return

    title = "Miootz chat"
    sender_name = message.user.display_name if message.user else "Unknown"
    body = f"{sender_name}: {message.message[:200]}"
    data = _payload(
        title,
        body,
        f"/meetups/{message.meetup_id}/chat",
        tag=f"meetup-chat-{message.meetup_id}",
        message_id=message.id,
    )
    await _send_push_to_users(db, user_ids, data, category="chat")


async def send_queued_chat_notification(message_id: int) -> None:
    """Send after the read grace period, using a fresh database session."""
    from app.core.database import async_session

    async with async_session() as db:
        message = await db.scalar(
            select(ChatMessage)
            .where(ChatMessage.id == message_id)
            .options(selectinload(ChatMessage.user))
        )
        if message is not None:
            await notify_meetup_chat_recipients(db, message)


async def notify_meetup_cancelled_recipients(
    db: AsyncSession,
    meetup: Meetup,
) -> None:
    """Notify all non-cancelled attendees that an admin removed the meetup."""
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    r = await db.execute(
        select(Attendance.user_id).where(
            Attendance.meetup_id == meetup.id,
            Attendance.status != "cancelled",
        )
    )
    user_ids = {row[0] for row in r.all()}
    if not user_ids:
        return

    loc = (meetup.location or "Meetup")[:120]
    data = _payload(
        title="Meetup cancelled",
        body=f"{loc} — this meetup was removed from the schedule.",
        url="/meetups",
    )
    await _send_push_to_users(db, user_ids, data, category="meetup_cancelled")


async def notify_kickoff_reminder_for_meetup(
    db: AsyncSession,
    meetup: Meetup,
) -> None:
    """Notify all non-cancelled attendees that kickoff is in about one hour."""
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    r = await db.execute(
        select(Attendance.user_id).where(
            Attendance.meetup_id == meetup.id,
            Attendance.status != "cancelled",
        )
    )
    user_ids = {row[0] for row in r.all()}
    if not user_ids:
        return

    loc = (meetup.location or "Meetup")[:120]
    data = _payload(
        title="Kickoff in 1 hour",
        body=f"{loc} — see you at the pitch!",
        url=f"/meetups/{meetup.id}",
        actions=[
            _action("view", "View", meetup),
        ],
    )
    await _send_push_to_users(db, user_ids, data, category="kickoff_reminder")


async def notify_rating_reminder_for_meetup(
    db: AsyncSession,
    meetup: Meetup,
) -> None:
    """Notify all confirmed attendees to rate their peers after the meetup ends."""
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return
    mode = (await get_rating_settings(db)).peer_rating_mode
    if mode == "off":
        return

    r = await db.execute(
        select(Attendance.user_id).where(
            Attendance.meetup_id == meetup.id,
            Attendance.status == "confirmed",
        )
    )
    user_ids = {row[0] for row in r.all()}
    if mode == "teammates-only":
        pairs = (await teammate_pairs(db, [meetup.id]))[meetup.id]
        user_ids = {
            user_id
            for pair in pairs
            if set(pair) <= user_ids
            for user_id in pair
        }
    elif len(user_ids) < 2:
        return
    if not user_ids:
        return

    loc = (meetup.location or "Meetup")[:120]
    data = _payload(
        title="Rate your teammates",
        body=f"{loc} — rate the players from this meetup",
        url=f"/meetups/{meetup.id}",
        actions=[
            _action("rate", "Rate", meetup),
        ],
    )
    await _send_push_to_users(db, user_ids, data, category="rating_reminder")
