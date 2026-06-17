from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.user import User
from app.models.session import MatchScore, Attendance
from app.schemas.stats import UserStats, MatchScoreReport
from app.services.stats_service import get_user_statistics

router = APIRouter(prefix="/users", tags=["users"])


async def get_current_authenticated_user(request: Request) -> User:
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return request.state.user


@router.get("/me/stats", response_model=UserStats)
async def get_my_stats(
    current_user: User = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
):
    stats = await get_user_statistics(db, current_user.id)
    return stats


@router.post("/report-score")
async def report_match_score(
    report: MatchScoreReport,
    request: Request,
    current_user: User = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify: admin OR attended the session
    is_admin = getattr(request.state, "is_admin", False)
    if not is_admin:
        att = await db.execute(
            select(Attendance).where(
                Attendance.session_id == report.session_id,
                Attendance.user_id == current_user.id,
                Attendance.status == "confirmed",
            )
        )
        if not att.scalar_one_or_none():
            raise HTTPException(
                status_code=403,
                detail="Only admins or confirmed attendees can report scores",
            )

    # Validate score range
    if not 1 <= report.score <= 5:
        raise HTTPException(status_code=400, detail="Score must be between 1 and 5")

    # Upsert: replace existing score for this player+session+type
    existing = await db.execute(
        select(MatchScore).where(
            MatchScore.session_id == report.session_id,
            MatchScore.player_id == report.player_id,
            MatchScore.type == report.type,
        )
    )
    existing_score = existing.scalar_one_or_none()
    if existing_score:
        existing_score.score = report.score
    else:
        new_score = MatchScore(
            session_id=report.session_id,
            player_id=report.player_id,
            score=report.score,
            type=report.type,
        )
        db.add(new_score)

    await db.commit()
    return {"status": "success", "message": "Score reported successfully"}
