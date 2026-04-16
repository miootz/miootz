from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services.magic_links import verify_action_token
from app.services.session_actions import (
    process_magic_cancel,
    process_magic_confirm,
    process_magic_reactivate,
)

router = APIRouter(prefix="/session-links", tags=["session-links"])


def _page(title: str, body: str) -> HTMLResponse:
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem}}
a{{color:#6d28d9}}</style></head>
<body><h1>{title}</h1><p>{body}</p><p><a href="/">Home</a></p></body></html>"""
    return HTMLResponse(content=html)


@router.get("/confirm")
async def magic_confirm(t: str, db: AsyncSession = Depends(get_db)):
    try:
        data = verify_action_token(t)
        if data.get("act") != "confirm":
            return _page("Invalid link", "This link is not a confirm link.")
    except ValueError as e:
        return _page("Link error", str(e))

    msg = await process_magic_confirm(db, int(data["sid"]), int(data["uid"]))
    return _page("Confirm", msg)


@router.get("/cancel")
async def magic_cancel(t: str, db: AsyncSession = Depends(get_db)):
    try:
        data = verify_action_token(t)
        if data.get("act") != "cancel":
            return _page("Invalid link", "This link is not a cancel link.")
    except ValueError as e:
        return _page("Link error", str(e))

    msg = await process_magic_cancel(db, int(data["sid"]), int(data["uid"]))
    return _page("Cancelled", msg)


@router.get("/reactivate")
async def magic_reactivate(t: str, db: AsyncSession = Depends(get_db)):
    try:
        data = verify_action_token(t)
        if data.get("act") != "reactivate":
            return _page("Invalid link", "This link is not a reactivate link.")
    except ValueError as e:
        return _page("Link error", str(e))

    msg = await process_magic_reactivate(db, int(data["sid"]), int(data["uid"]))
    return _page("Reactivate", msg)
