from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rating import Rating
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.core.timeutil import utcnow
from app.services import rankings_service


async def get_user_statistics(db: AsyncSession, user_id: int) -> dict:
    now = utcnow()
    result = await db.execute(
        select(func.count(Attendance.id))
        .join(Meetup, Meetup.id == Attendance.meetup_id)
        .where(
            Attendance.user_id == user_id,
            Attendance.status == "confirmed",
            Meetup.start_time <= now,
        )
    )
    games_played = result.scalar() or 0

    # Meetups attended in the current calendar year
    year_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.count(Attendance.id))
        .join(Meetup, Meetup.id == Attendance.meetup_id)
        .where(
            Attendance.user_id == user_id,
            Attendance.status == "confirmed",
            Meetup.start_time >= year_start,
            Meetup.start_time <= now,
        )
    )
    season_games = result.scalar() or 0

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
    skill_level = (
        user.calculated_skill if user and user.calculated_skill is not None else 0.0
    )

    try:
        average = round(float(avg_rating), 2)
    except TypeError, ValueError:
        average = 0.0

    all_time = await rankings_service.get_user_metrics(db, user_id)
    season = await rankings_service.get_user_metrics(db, user_id, year=now.year)

    return {
        "games_played": games_played,
        "season_games": season_games,
        "average_rating": average,
        "total_ratings": total_ratings,
        "skill_level": skill_level,
        "goals": all_time["goals"],
        "assists": all_time["assists"],
        "clean_sheets": all_time["clean_sheets"],
        "goals_conceded": all_time["goals_conceded"],
        "season_goals": season["goals"],
        "season_assists": season["assists"],
        "season_clean_sheets": season["clean_sheets"],
        "season_goals_conceded": season["goals_conceded"],
    }
