import re
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.audit_db import audit_session
from app.core.database import get_db
from app.core.timeutil import to_utc
from app.models.audit import AuditLog, RATING_AUDIT_DESCRIPTIONS
from app.models.meetup import Meetup
from app.models.user import User

router = APIRouter(prefix="/audit", tags=["audit"])

# Older entries embedded venue names and, for lifecycle events, UTC start times.
LEGACY_MEETUP_DESCRIPTIONS = {
    "meetup.created": (r"^Created meetup '.*?'(?: for \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)?(?= \(|$)", "Created meetup"),
    "meetup.updated": (r"^Updated '.*?'(?= — changed:)", "Updated meetup"),
    "meetup.skipped": (r"^Skipped '.*?' \([^)]* UTC\);", "Skipped meetup;"),
    "meetup.deleted": (r"^Deleted meetup '.*?'(?: \([^)]* UTC\))?(?= and |$)", "Deleted meetup"),
    "teams.lineup_saved": (r" for '.*?'(?= \()", ""),
    "teams.reshuffled": (r" for '.*?'(?= \()", ""),
    "teams.adjusted": (r" for '.*?'(?= by )", ""),
    "teams.reshaped": (r"^Reshaped '.*?'(?= into )", "Reshaped teams"),
    "attendance.joined": (r" (?:to )?'.*?'(?= as [\w-]+$)", ""),
    "attendance.left": (r"^Cancelled attendance for '.*?'(?= \(was )", "Cancelled attendance"),
    "award.weather_hero_granted": (r" of '.*?'(?= \(all already held one\)$|$)", ""),
    "award.weather_hero_redeemed": (r" for '.*?'(?=, upgraded to confirmed)", ""),
    "plus_one.added": (r" at '.*?'(?= \(guest )", ""),
    "match.started": (r"^Started match meetups at '.*?':", "Started matches:"),
}
LEGACY_MEETUP_DATE_ACTIONS = {"meetup.created", "meetup.skipped", "meetup.deleted"}
LEGACY_START_TIME = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC")


def _filter(
    stmt,
    *,
    q: str | None,
    category: str | None,
    start: datetime | None,
    end: datetime | None,
):
    if category:
        stmt = stmt.where(AuditLog.category == category)
    if q and q.strip():
        like = f"%{q.strip()}%"
        description = case(
            RATING_AUDIT_DESCRIPTIONS, value=AuditLog.action, else_=AuditLog.description
        )
        stmt = stmt.where(
            or_(
                AuditLog.username.ilike(like),
                AuditLog.display_name.ilike(like),
                description.ilike(like),
                AuditLog.action.ilike(like),
            )
        )
    if start is not None:
        stmt = stmt.where(AuditLog.created_at >= start)
    if end is not None:
        stmt = stmt.where(AuditLog.created_at <= end)
    return stmt


def _legacy_start_time(r: AuditLog) -> datetime | None:
    if r.action in LEGACY_MEETUP_DATE_ACTIONS:
        match = LEGACY_START_TIME.search(r.description)
        if match:
            try:
                return datetime.fromisoformat(match[1])
            except ValueError:
                pass
    return None


def _row(r: AuditLog, meetup_start: datetime | None) -> dict:
    description = RATING_AUDIT_DESCRIPTIONS.get(r.action, r.description)
    if r.meetup_id is not None and r.meetup_start_time is None and r.action in LEGACY_MEETUP_DESCRIPTIONS:
        pattern, replacement = LEGACY_MEETUP_DESCRIPTIONS[r.action]
        description = re.sub(pattern, replacement, description, count=1)
    return {
        "id": r.id,
        "created_at": r.created_at.isoformat(),
        "user_id": r.user_id,
        "username": r.username,
        "display_name": r.display_name,
        "is_admin": r.is_admin,
        "category": r.category,
        "action": r.action,
        "description": description,
        "meetup_id": r.meetup_id,
        "meetup_start_time": to_utc(meetup_start).isoformat() if meetup_start else None,
    }


@router.get("/logs")
async def list_audit_logs(
    q: str | None = Query(default=None, max_length=200),
    category: str | None = Query(default=None, max_length=32),
    start: datetime | None = None,
    end: datetime | None = None,
    order: str = Query(default="desc", pattern="^(desc|asc)$"),
    group_by: str = Query(default="none", pattern="^(none|category|user)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(require_admin),
    game_db: AsyncSession = Depends(get_db),
):
    """Read-only audit log: search, filter, sort by time, pivot by category/user."""
    async with audit_session() as db:
        base = _filter(
            select(AuditLog), q=q, category=category, start=start, end=end
        )
        if group_by == "none":
            total = (
                await db.execute(
                    select(func.count()).select_from(base.subquery())
                )
            ).scalar()
            rows = (
                (
                    await db.execute(
                        base.order_by(
                            AuditLog.created_at.desc()
                            if order == "desc"
                            else AuditLog.created_at.asc(),
                            AuditLog.id.desc(),
                        )
                        .limit(limit)
                        .offset(offset)
                    )
                )
                .scalars()
                .all()
            )
            missing_ids = {
                r.meetup_id for r in rows
                if r.meetup_id is not None and r.meetup_start_time is None
            }
            starts: dict[int, datetime] = {}
            if missing_ids:
                starts.update(
                    (await game_db.execute(
                        select(Meetup.id, Meetup.start_time).where(Meetup.id.in_(missing_ids))
                    )).tuples().all()
                )
                deleted_ids = missing_ids - starts.keys()
                if deleted_ids:
                    lifecycle_rows = (await db.scalars(
                        select(AuditLog)
                        .where(
                            AuditLog.meetup_id.in_(deleted_ids),
                            AuditLog.action.in_(LEGACY_MEETUP_DATE_ACTIONS),
                        )
                        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
                    )).all()
                    for lifecycle in lifecycle_rows:
                        start_time = lifecycle.meetup_start_time or _legacy_start_time(lifecycle)
                        if start_time is not None:
                            starts.setdefault(lifecycle.meetup_id, start_time)
            return {
                "items": [
                    _row(r, r.meetup_start_time or _legacy_start_time(r) or starts.get(r.meetup_id))
                    for r in rows
                ],
                "total": total or 0,
            }

        key = AuditLog.category if group_by == "category" else AuditLog.username
        base = _filter(select(key, func.count()), q=q, category=category, start=start, end=end)
        rows = (
            await db.execute(
                base.group_by(key).order_by(func.count().desc(), key.asc().nulls_last())
            )
        ).all()
        return {
            "items": [{"key": k, "count": c} for k, c in rows if k is not None]
        }
