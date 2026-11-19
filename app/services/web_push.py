import asyncio
import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.models.user_notification_preference import UserNotificationPreference
from app.models.web_push_subscription import WebPushSubscription
from app.services.peer_rating_policy import teammate_pairs
from app.services.rating_settings import get_rating_settings

logger = logging.getLogger(__name__)


# ── helpers ──────────────────────────────────────────────────────────


def _payload(
    title: str,
    body: str,
    url: str | None = None,
    actions: list[dict] | None = None,
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


async def user_wants_notification(
    db: AsyncSession,
    user_id: int,
    category: str,
) -> bool:
    """Check if a user has a specific notification category enabled (default True)."""
    r = await db.execute(
        select(UserNotificationPreference.enabled).where(
            UserNotificationPreference.user_id == user_id,
            UserNotificationPreference.category == category,
        )
    )
    row = r.scalar_one_or_none()
    if row is None:
        return True
    return bool(row)


async def _get_user_subs_with_filter(
    db: AsyncSession,
    user_ids: set[int],
    category: str,
) -> dict[int, list[WebPushSubscription]]:
    """Fetch push subscriptions for users who want this notification category."""
    allowed: dict[int, bool] = {}
    for uid in user_ids:
        allowed[uid] = await user_wants_notification(db, uid, category)

    result: dict[int, list[WebPushSubscription]] = {}
    for uid, wants in allowed.items():
        if not wants:
            continue
        subs = (
            (
                await db.execute(
                    select(WebPushSubscription).where(
                        WebPushSubscription.user_id == uid
                    )
                )
            )
            .scalars()
            .all()
        )
        if subs:
            result[uid] = list(subs)
    return result


async def _send_push_to_users(
    db: AsyncSession,
    user_ids: set[int],
    data: str,
    category: str | None = None,
) -> dict[str, int]:
    """Send push notification to users, optionally filtering by preference category."""
    counts = {"sent": 0, "failed": 0, "expired": 0}
    if not user_ids:
        return counts

    if category:
        uid_to_subs = await _get_user_subs_with_filter(db, user_ids, category)
    else:
        uid_to_subs: dict[int, list[WebPushSubscription]] = {}
        for uid in user_ids:
            subs = (
                (
                    await db.execute(
                        select(WebPushSubscription).where(
                            WebPushSubscription.user_id == uid
                        )
                    )
                )
                .scalars()
                .all()
            )
            if subs:
                uid_to_subs[uid] = list(subs)

    dead_ids: list[int] = []
    for uid, subs in uid_to_subs.items():
        for sub in subs:
            try:
                await asyncio.to_thread(_send_one, sub, data)
                counts["sent"] += 1
            except WebPushException as e:
                logger.debug("webpush fail uid=%s sub=%s: %s", uid, sub.id, e)
                if _is_subscription_gone(e):
                    dead_ids.append(sub.id)
                    counts["expired"] += 1
                else:
                    counts["failed"] += 1
            except Exception as e:
                logger.warning("webpush error uid=%s sub=%s: %s", uid, sub.id, e)
                counts["failed"] += 1

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
    data = _payload(
        title="Miootz: new meetup",
        body=f"{loc} — {summary}",
        url=f"/meetup-action?mid={meetup.id}&act=join",
        actions=[
            _action("join", "Join", meetup),
            _action("ignore", "Ignore", meetup),
        ],
    )
    await _send_push_to_users(db, user_ids, data, category="meetup_invite")


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
    meetup_id: int,
    sender_user_id: int,
    sender_username: str,
    message_preview: str,
) -> None:
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    r = await db.execute(
        select(Attendance.user_id).where(
            Attendance.meetup_id == meetup_id,
            Attendance.user_id != sender_user_id,
            Attendance.status != "cancelled",
        )
    )
    user_ids = {row[0] for row in r.all()}
    if not user_ids:
        return

    title = "Miootz chat"
    body = f"{sender_username}: {message_preview[:200]}"
    data = _payload(title, body, f"/meetups/{meetup_id}")
    await _send_push_to_users(db, user_ids, data, category="chat")


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
