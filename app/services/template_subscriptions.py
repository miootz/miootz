"""Default-on template notification preferences (opt-out via GameTemplateSubscription row)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.game_template_subscription import GameTemplateSubscription


async def user_wants_template_notifications(
    db: AsyncSession, user_id: int, game_template_id: int
) -> bool:
    r = await db.execute(
        select(GameTemplateSubscription.notifications_enabled).where(
            GameTemplateSubscription.user_id == user_id,
            GameTemplateSubscription.game_template_id == game_template_id,
        )
    )
    row = r.scalar_one_or_none()
    if row is None:
        return True
    return bool(row)


async def filter_users_by_template_subscription(
    db: AsyncSession, user_ids: list[int], game_template_id: int
) -> list[int]:
    """Return user_ids that should receive new-meetup notifications for this template."""
    if not user_ids:
        return []
    r = await db.execute(
        select(GameTemplateSubscription).where(
            GameTemplateSubscription.user_id.in_(user_ids),
            GameTemplateSubscription.game_template_id == game_template_id,
        )
    )
    explicit = {row.user_id: row.notifications_enabled for row in r.scalars().all()}
    out: list[int] = []
    for uid in user_ids:
        if uid not in explicit:
            out.append(uid)
        elif explicit[uid]:
            out.append(uid)
    return out
