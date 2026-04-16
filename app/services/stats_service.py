from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.session import Attendance
from app.models.rating import Rating


async def get_user_statistics(db: AsyncSession, user_id: int) -> dict:
    result = await db.execute(
        select(func.count(Attendance.id)).where(
            Attendance.user_id == user_id, Attendance.status == "confirmed"
        )
    )
    games_played = result.scalar() or 0

    result = await db.execute(
        select(func.avg(Rating.score)).where(Rating.ratee_id == user_id)
    )
    avg_rating = result.scalar() or 0.0

    result = await db.execute(
        select(func.count(Rating.id)).where(Rating.ratee_id == user_id)
    )
    total_ratings = result.scalar() or 0

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    skill_level = user.calculated_skill if user else 0

    return {
        "games_played": games_played,
        "average_rating": round(float(avg_rating), 2),
        "total_ratings": total_ratings,
        "skill_level": skill_level,
    }
