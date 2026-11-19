from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.award import WeatherHeroAward
from app.models.rating import Rating
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.core.timeutil import utcnow
from app.services import rankings_service
from app.services.rating_settings import get_rating_settings, selected_rating


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
        select(func.avg(Rating.score)).where(
            Rating.ratee_id == user_id, Rating.score.between(1, 5)
        )
    )
    avg_rating = result.scalar() or 0.0

    result = await db.execute(
        select(func.count(Rating.id)).where(
            Rating.ratee_id == user_id, Rating.score.between(1, 5)
        )
    )
    total_ratings = result.scalar() or 0

    weather_hero_unused = (
        await db.execute(
            select(func.count(WeatherHeroAward.id)).where(
                WeatherHeroAward.user_id == user_id,
                WeatherHeroAward.used_at.is_(None),
            )
        )
    ).scalar_one()

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    computed_scores = (await get_rating_settings(db)).computed_scores
    skill_level = selected_rating(user, computed_scores) if user is not None else None

    try:
        average = round(float(avg_rating), 2)
    except TypeError, ValueError:
        average = 0.0

    all_time = await rankings_service.get_user_metrics(db, user_id)
    season = await rankings_service.get_user_metrics(
        db, user_id, year=now.year, include_ranked_metrics=True
    )

    def _rate(m: dict[str, int | float]) -> float:
        return round(m["wins"] / m["matches"], 3) if m["matches"] else 0.0

    return {
        "games_played": games_played,
        "season_games": season_games,
        "average_rating": average,
        "total_ratings": total_ratings,
        "skill_level": skill_level if skill_level is not None else 0.0,
        "computed_scores": computed_scores,
        "base_rating": user.seed_skill if user is not None else None,
        "adjusted_rating": user.calculated_skill
        if user is not None and computed_scores
        else None,
        "goals": all_time["goals"],
        "assists": all_time["assists"],
        "clean_sheets": all_time["clean_sheets"],
        "goals_conceded": all_time["goals_conceded"],
        "wins": all_time["wins"],
        "matches": all_time["matches"],
        "win_rate": _rate(all_time),
        "season_goals": season["goals"],
        "season_assists": season["assists"],
        "season_clean_sheets": season["clean_sheets"],
        "season_goals_conceded": season["goals_conceded"],
        "season_wins": season["wins"],
        "season_losses": season.get("losses", 0),
        "season_matches": season["matches"],
        "season_win_rate": _rate(season),
        "season_goal_assists_per_match": season.get("goal_assists_per_match", 0.0),
        "season_penalties_taken": season.get("penalties_taken", 0),
        "season_penalties_scored": season.get("penalties_scored", 0),
        "season_penalty_conversion_rate": season.get("penalty_conversion_rate", 0.0),
        "weather_hero_unused": weather_hero_unused,
    }
