"""Audit log writer.

``log_action`` is fire-and-forget: it spawns a guarded task that inserts a row
into the separate audit database. A failure (or a dead audit database) is
logged and swallowed — it must never block or fail the action being recorded.
"""

import asyncio
import logging
from datetime import datetime

from fastapi import Request

from app.core.audit_db import audit_session
from app.core.timeutil import utcnow
from app.models.audit import AuditLog, RATING_AUDIT_DESCRIPTIONS

logger = logging.getLogger(__name__)

#: Audit categories (machine name -> human label for the admin UI).
CATEGORIES: dict[str, str] = {
    "meetup": "Meetup",
    "attendance": "Attendance",
    "teams": "Teams",
    "match": "Match",
    "referee": "Referee",
    "template": "Template",
    "user": "User",
    "rating": "Rating",
    "plus_one": "Plus-one",
}


#: Strong references to in-flight audit writes (asyncio keeps only weak refs).
_pending: set[asyncio.Task] = set()


def log_action(
    request: Request,
    category: str,
    action: str,
    description: str,
    *,
    meetup_id: int | None = None,
    meetup_start_time: datetime | None = None,
) -> None:
    """Record an action; never raises, never blocks the caller."""
    user = getattr(request.state, "user", None)
    username = getattr(user, "sso_preferred_username", None) or getattr(
        user, "sso_display_name", None
    )
    task = asyncio.create_task(
        _insert(
            created_at=utcnow(),
            user_id=user.id if user is not None else None,
            username=username,
            display_name=getattr(user, "sso_display_name", None),
            is_admin=bool(getattr(request.state, "is_admin", False)),
            category=category,
            action=action,
            description=RATING_AUDIT_DESCRIPTIONS.get(action, description),
            meetup_id=meetup_id,
            meetup_start_time=meetup_start_time,
        )
    )
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def _insert(**fields) -> None:
    try:
        async with audit_session() as db:
            db.add(AuditLog(**fields))
            await db.commit()
    except Exception:
        logger.exception(
            "Audit write failed: %s %s", fields["category"], fields["action"]
        )


async def prune_audit_log(retention_days: int) -> None:
    """Delete rows older than the retention window (hourly scheduler job)."""
    from datetime import timedelta

    try:
        async with audit_session() as db:
            result = await db.execute(
                AuditLog.__table__.delete().where(
                    AuditLog.created_at < utcnow() - timedelta(days=retention_days)
                )
            )
            await db.commit()
            if result.rowcount:
                logger.info("Audit prune: removed %d rows", result.rowcount)
    except Exception:
        logger.exception("Audit prune failed")
