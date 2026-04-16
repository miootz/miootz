from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.user import User
from app.models.session import MatchScore
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
    current_user: User = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
):
    # In a real app, we'd verify if current_user is an admin or attended the session
    new_score = MatchScore(
        session_id=report.session_id,
        player_id=report.player_id,
        score=report.score,
        type=report.type,
    )
    db.add(new_score)
    await db.commit()
    return {"status": "success", "message": "Score reported successfully"}
