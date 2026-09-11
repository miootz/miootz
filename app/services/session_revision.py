"""Bump monotonic content_revision and notify SSE subscribers."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.session_data_manager import session_data_manager
from app.models.session import GameSession


async def bump_session_revision(db: AsyncSession, session_id: int) -> int | None:
    s = await db.get(GameSession, session_id)
    if not s:
        return None
    s.content_revision = (s.content_revision or 0) + 1
    await db.flush()
    return s.content_revision


async def bump_and_notify(db: AsyncSession, session_id: int) -> None:
    """Persist a content_revision bump and broadcast it over SSE.

    Always use this (instead of computing ``revision + 1`` locally) so the
    DB counter and the broadcast values never diverge.
    """
    rev = await bump_session_revision(db, session_id)
    await db.commit()
    if rev is not None:
        await notify_session_data_changed(session_id, rev)


async def notify_session_data_changed(session_id: int, revision: int) -> None:
    await session_data_manager.broadcast(
        session_id,
        {
            "type": "session_updated",
            "session_id": session_id,
            "revision": revision,
        },
    )


async def notify_session_deleted(session_id: int) -> None:
    await session_data_manager.broadcast(
        session_id,
        {
            "type": "session_deleted",
            "session_id": session_id,
        },
    )
