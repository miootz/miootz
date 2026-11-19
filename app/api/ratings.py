from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.meetup import Meetup, Attendance
from app.models.rating import Rating
from app.schemas.rating import (
    RatingContextResponse,
    RatingCreate,
    RatingResponse,
    RateeContext,
)
from app.services.rating_windows import (
    may_rate_or_edit,
    next_meetup_start_after,
    ratings_locked,
    meetup_end_time,
    to_utc_aware,
    utc_now,
)
from app.services.skill_service import update_user_calculated_skill
from app.core.timeutil import utcnow
from app.services.audit import log_action

router = APIRouter(prefix="/ratings", tags=["ratings"])


def get_current_user(request: Request) -> User:
    user = request.state.user
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return user


@router.post("/", response_model=RatingResponse | None)
async def upsert_rating(
    rating_data: RatingCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Meetup).where(Meetup.id == rating_data.meetup_id)
    )
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    now = utc_now()
    nxt = await next_meetup_start_after(db, meetup)
    ok, reason = may_rate_or_edit(now, meetup, nxt)
    if not ok:
        raise HTTPException(status_code=400, detail=reason or "Cannot rate")

    result = await db.execute(
        select(Attendance).where(
            Attendance.meetup_id == rating_data.meetup_id,
            Attendance.user_id == current_user.id,
            Attendance.status == "confirmed",
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only rate players from meetups you attended",
        )

    if rating_data.ratee_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot rate yourself"
        )

    result = await db.execute(
        select(Attendance).where(
            Attendance.meetup_id == rating_data.meetup_id,
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
            Rating.meetup_id == rating_data.meetup_id,
            Rating.rater_id == current_user.id,
            Rating.ratee_id == rating_data.ratee_id,
        )
    )
    existing = result.scalar_one_or_none()
    ratee = await db.get(User, rating_data.ratee_id)
    ratee_name = ratee.display_name if ratee else str(rating_data.ratee_id)
    if rating_data.score == 0:
        if existing:
            await db.delete(existing)
            await db.flush()
            await update_user_calculated_skill(
                db, user_id=rating_data.ratee_id, commit=False
            )
            await db.commit()
            log_action(
                request,
                "rating",
                "rating.cleared",
                f"Cleared rating of {ratee_name} for '{meetup.location}'",
                meetup_id=rating_data.meetup_id,
            )
        return None

    if existing:
        existing.score = rating_data.score
        existing.updated_at = utcnow()
        await db.flush()
        await update_user_calculated_skill(db, user_id=rating_data.ratee_id, commit=False)
        await db.commit()
        await db.refresh(existing)
        log_action(
            request,
            "rating",
            "rating.updated",
            f"Updated rating of {ratee_name} for '{meetup.location}' to "
            f"{rating_data.score}/5",
            meetup_id=rating_data.meetup_id,
        )
        return existing

    new_rating = Rating(
        meetup_id=rating_data.meetup_id,
        rater_id=current_user.id,
        ratee_id=rating_data.ratee_id,
        score=rating_data.score,
    )
    db.add(new_rating)
    await db.flush()
    await update_user_calculated_skill(db, user_id=rating_data.ratee_id, commit=False)
    await db.commit()
    await db.refresh(new_rating)
    log_action(
        request,
        "rating",
        "rating.submitted",
        f"Rated {ratee_name} {rating_data.score}/5 for '{meetup.location}'",
        meetup_id=rating_data.meetup_id,
    )

    return new_rating


@router.get("/meetups/{meetup_id}/context", response_model=RatingContextResponse)
async def get_rating_context(
    meetup_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    now = utc_now()
    nxt = await next_meetup_start_after(db, meetup)
    ok, _ = may_rate_or_edit(now, meetup, nxt)
    before_end = now < meetup_end_time(meetup)
    locked = ratings_locked(now, meetup, nxt) and not before_end

    result = await db.execute(
        select(Attendance).where(
            Attendance.meetup_id == meetup_id,
            Attendance.user_id == current_user.id,
            Attendance.status == "confirmed",
        )
    )
    viewer_attended = result.scalar_one_or_none() is not None
    if not viewer_attended:
        ok = False

    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(
            Attendance.meetup_id == meetup_id,
            Attendance.status == "confirmed",
            Attendance.user_id != current_user.id,
        )
        .order_by(User.sso_display_name.asc())
    )
    rows = result.all()

    ratee_ids = [u.id for _, u in rows]
    my_scores: dict[int, int] = {}
    if viewer_attended and ratee_ids:
        r2 = await db.execute(
            select(Rating).where(
                Rating.meetup_id == meetup_id,
                Rating.rater_id == current_user.id,
                Rating.ratee_id.in_(ratee_ids),
                Rating.score.between(1, 5),
            )
        )
        for r in r2.scalars().all():
            my_scores[r.ratee_id] = r.score

    ratees = [
        RateeContext(
            user_id=u.id,
            display_name=u.display_name,
            avatar_url=u.avatar_url,
            my_score=my_scores.get(u.id),
        )
        for _, u in rows
    ]

    locks_at = to_utc_aware(nxt) if nxt else None
    end = meetup_end_time(meetup)
    return RatingContextResponse(
        meetup_id=meetup_id,
        meetup_start_time=meetup.start_time,
        meetup_end_time=end,
        before_meetup_end=before_end,
        ratings_locked=locked,
        ratings_editable=ok,
        ratings_lock_at=locks_at.isoformat() if locks_at else None,
        viewer_attended=viewer_attended,
        ratees=ratees,
    )


@router.get("/players/{player_id}", response_model=dict)
async def get_player_ratings(
    player_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Rating).where(Rating.ratee_id == player_id, Rating.score.between(1, 5))
    )
    ratings = result.scalars().all()

    if not ratings:
        return {"average_score": 0, "total_ratings": 0}

    avg_score = sum(r.score for r in ratings) / len(ratings)
    return {"average_score": round(avg_score, 2), "total_ratings": len(ratings)}
