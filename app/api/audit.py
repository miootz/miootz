import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select

from app.api.deps import require_admin
from app.core.audit_db import audit_session
from app.models.audit import AuditLog
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/audit", tags=["audit"])


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
        stmt = stmt.where(
            or_(
                AuditLog.username.ilike(like),
                AuditLog.display_name.ilike(like),
                AuditLog.description.ilike(like),
                AuditLog.action.ilike(like),
            )
        )
    if start is not None:
        stmt = stmt.where(AuditLog.created_at >= start)
    if end is not None:
        stmt = stmt.where(AuditLog.created_at <= end)
    return stmt


def _row(r: AuditLog) -> dict:
    return {
        "id": r.id,
        "created_at": r.created_at.isoformat(),
        "user_id": r.user_id,
        "username": r.username,
        "display_name": r.display_name,
        "is_admin": r.is_admin,
        "category": r.category,
        "action": r.action,
        "description": r.description,
        "meetup_id": r.meetup_id,
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
            return {"items": [_row(r) for r in rows], "total": total or 0}

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
