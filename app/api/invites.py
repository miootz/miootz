import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.invite import InviteToken
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/invites", tags=["invites"])


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
    base = settings.POCKET_ID_APP_URL.rstrip("/")
    return [
        {
            "token": r.token,
            "first_name": r.first_name,
            "last_name": r.last_name,
            "user_id": r.user_id,
            "created_at": r.created_at.isoformat(),
            "expires_at": r.expires_at.isoformat(),
            "used": r.used,
            "invite_link": f"{base}/st/{r.token}",
        }
        for r in rows
    ]
