from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.session import GameSession, Attendance
from app.models.rating import Rating
from app.schemas.rating import RatingCreate, RatingResponse
from app.services.skill_service import update_user_calculated_skill

router = APIRouter(prefix="/ratings", tags=["ratings"])


def get_current_user(request: Request) -> User:
    user = request.state.user
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return user


@router.post("/", response_model=RatingResponse, status_code=status.HTTP_201_CREATED)
async def create_rating(
    rating_data: RatingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GameSession).where(GameSession.id == rating_data.session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(Attendance).where(
            Attendance.session_id == rating_data.session_id,
            Attendance.user_id == current_user.id,
            Attendance.status == "confirmed",
        )
    )
    attendance = result.scalar_one_or_none()

    if not attendance:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only rate players from sessions you attended",
        )

    if rating_data.ratee_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot rate yourself"
        )

    result = await db.execute(
        select(Rating).where(
            Rating.session_id == rating_data.session_id,
            Rating.rater_id == current_user.id,
            Rating.ratee_id == rating_data.ratee_id,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have already rated this player for this session",
        )

    new_rating = Rating(
        session_id=rating_data.session_id,
        rater_id=current_user.id,
        ratee_id=rating_data.ratee_id,
        score=rating_data.score,
    )
    db.add(new_rating)
    await db.commit()
    await db.refresh(new_rating)

    await update_user_calculated_skill(db, user_id=rating_data.ratee_id)

    return new_rating


@router.get("/players/{player_id}", response_model=dict)
async def get_player_ratings(
    player_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Rating).where(Rating.ratee_id == player_id))
    ratings = result.scalars().all()

    if not ratings:
        return {"average_score": 0, "total_ratings": 0}

    avg_score = sum(r.score for r in ratings) / len(ratings)
    return {"average_score": round(avg_score, 2), "total_ratings": len(ratings)}
