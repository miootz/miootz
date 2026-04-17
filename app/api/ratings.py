from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.session import GameSession, Attendance
from app.models.rating import Rating
from app.schemas.rating import (
    RatingContextResponse,
    RatingCreate,
    RatingResponse,
    RateeContext,
)
from app.services.rating_windows import (
    may_rate_or_edit,
    next_session_start_after,
    ratings_locked,
    to_utc_aware,
    utc_now,
)
from app.services.skill_service import update_user_calculated_skill

router = APIRouter(prefix="/ratings", tags=["ratings"])


def get_current_user(request: Request) -> User:
    user = request.state.user
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return user


@router.post("/", response_model=RatingResponse)
async def upsert_rating(
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

    now = utc_now()
    nxt = await next_session_start_after(db, session)
    ok, reason = may_rate_or_edit(now, session, nxt)
    if not ok:
        raise HTTPException(status_code=400, detail=reason or "Cannot rate")

    result = await db.execute(
        select(Attendance).where(
            Attendance.session_id == rating_data.session_id,
            Attendance.user_id == current_user.id,
            Attendance.status == "confirmed",
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only rate players from sessions you attended",
        )

    if rating_data.ratee_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot rate yourself"
        )

    result = await db.execute(
        select(Attendance).where(
            Attendance.session_id == rating_data.session_id,
            Attendance.user_id == rating_data.ratee_id,
            Attendance.status == "confirmed",
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=400, detail="You can only rate confirmed attendees"
        )

    result = await db.execute(
        select(Rating).where(
            Rating.session_id == rating_data.session_id,
            Rating.rater_id == current_user.id,
            Rating.ratee_id == rating_data.ratee_id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.score = rating_data.score
        existing.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(existing)
        await update_user_calculated_skill(db, user_id=rating_data.ratee_id)
        return existing

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


@router.get("/sessions/{session_id}/context", response_model=RatingContextResponse)
async def get_rating_context(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(GameSession).where(GameSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    now = utc_now()
    nxt = await next_session_start_after(db, session)
    ok, _ = may_rate_or_edit(now, session, nxt)
    before_start = now < to_utc_aware(session.start_time)
    locked = ratings_locked(now, session, nxt) and not before_start

    result = await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.user_id == current_user.id,
            Attendance.status == "confirmed",
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=403,
            detail="You can only view ratings for sessions you attended",
        )

    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(
            Attendance.session_id == session_id,
            Attendance.status == "confirmed",
            Attendance.user_id != current_user.id,
        )
        .order_by(User.username.asc())
    )
    rows = result.all()

    ratee_ids = [u.id for _, u in rows]
    my_scores: dict[int, int] = {}
    if ratee_ids:
        r2 = await db.execute(
            select(Rating).where(
                Rating.session_id == session_id,
                Rating.rater_id == current_user.id,
                Rating.ratee_id.in_(ratee_ids),
            )
        )
        for r in r2.scalars().all():
            my_scores[r.ratee_id] = r.score

    ratees = [
        RateeContext(
            user_id=u.id,
            display_name=u.full_name or u.username,
            profile_pic=u.profile_pic,
            my_score=my_scores.get(u.id),
        )
        for _, u in rows
    ]

    locks_at = to_utc_aware(nxt) if nxt else None
    return RatingContextResponse(
        session_id=session_id,
        session_start_time=session.start_time,
        before_session_start=before_start,
        ratings_locked=locked,
        ratings_editable=ok,
        ratings_lock_at=locks_at.isoformat() if locks_at else None,
        ratees=ratees,
    )


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
