from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services.magic_links import verify_action_token
from app.services.session_actions import (
    process_magic_cancel,
    process_magic_confirm,
    process_magic_reactivate,
)

router = APIRouter(prefix="/session-links", tags=["session-links"])


class SessionLinkTokenBody(BaseModel):
    t: str


@router.post("/action")
async def session_link_action_json(
    body: SessionLinkTokenBody,
    db: AsyncSession = Depends(get_db),
):
    """SPA email links: POST token from `/session-action?t=...`."""
    try:
        data = verify_action_token(body.t)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    act = data.get("act")
    sid, uid = int(data["sid"]), int(data["uid"])
    if act == "confirm":
        msg = await process_magic_confirm(db, sid, uid)
    elif act == "cancel":
        msg = await process_magic_cancel(db, sid, uid)
    elif act == "reactivate":
        msg = await process_magic_reactivate(db, sid, uid)
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    return {"message": msg}
