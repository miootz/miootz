"""Bump monotonic content_revision and notify SSE subscribers."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.meetup_data_manager import meetup_data_manager
from app.models.meetup import Meetup


async def bump_meetup_revision(db: AsyncSession, meetup_id: int) -> int | None:
    s = await db.get(Meetup, meetup_id)
    if not s:
        return None
    s.content_revision = (s.content_revision or 0) + 1
    await db.flush()
    return s.content_revision


async def bump_and_notify(db: AsyncSession, meetup_id: int) -> None:
    """Persist a content_revision bump and broadcast it over SSE.

    Always use this (instead of computing ``revision + 1`` locally) so the
    DB counter and the broadcast values never diverge.
    """
    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)


async def notify_meetup_data_changed(meetup_id: int, revision: int) -> None:
    await meetup_data_manager.broadcast(
        meetup_id,
        {
            "type": "meetup_updated",
            "meetup_id": meetup_id,
            "revision": revision,
        },
    )


async def notify_meetup_list_changed() -> None:
    """Prompt open overviews to reload the list of available meetups."""
    await meetup_data_manager.broadcast(None, {"type": "meetup_list_changed"})


async def notify_meetup_deleted(meetup_id: int) -> None:
    await meetup_data_manager.broadcast(
        meetup_id,
        {
            "type": "meetup_deleted",
            "meetup_id": meetup_id,
        },
    )
