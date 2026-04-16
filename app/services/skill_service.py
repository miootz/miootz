from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.rating import Rating


async def update_user_calculated_skill(db: AsyncSession, user_id: int) -> None:
    """
    Recalculates the 'calculated_skill' for a user based on:
    (self_assessed_skill * W1 + average_peer_rating * W2) / (W1 + W2)

    Weights:
    - Self-assessment: 40% (0.4)
    - Peer ratings: 60% (0.6)
    """
    user = await db.get(User, user_id)
    if not user:
        return

    result = await db.execute(
        select(func.avg(Rating.score)).where(Rating.ratee_id == user_id)
    )
    avg_peer = result.scalar()

    if avg_peer is None:
        if user.self_assessed_skill is not None:
            user.calculated_skill = user.self_assessed_skill
            await db.commit()
        return

    W_SELF = 0.4
    W_PEER = 0.6
    self_val = user.self_assessed_skill if user.self_assessed_skill is not None else 0
    new_skill = (self_val * W_SELF) + (float(avg_peer) * W_PEER)
    user.calculated_skill = round(new_skill)
    await db.commit()
