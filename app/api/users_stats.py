from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.user import User
from app.models.meetup import MatchScore, Attendance
from app.schemas.stats import UserStats, MatchScoreReport
from app.services.stats_service import get_user_statistics
from app.services.player_attributes import (
    effective_player_attributes,
    load_player_attributes,
    pace_and_dribbling,
)
from app.services.audit import log_action

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
    if stats["computed_scores"]:
        attributes = (await load_player_attributes(db)).get(current_user.id)
        stats["attributes"] = {
            **effective_player_attributes(current_user, attributes),
            **pace_and_dribbling(current_user),
        }
    return stats


@router.post("/report-score")
async def report_match_score(
    report: MatchScoreReport,
    request: Request,
    current_user: User = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify: admin OR attended the meetup
    is_admin = getattr(request.state, "is_admin", False)
    if not is_admin:
        att = await db.execute(
            select(Attendance).where(
                Attendance.meetup_id == report.meetup_id,
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

    # Players may only score confirmed attendees of the same meetup;
    # admins may score anyone.
    if not is_admin:
        player_att = await db.execute(
            select(Attendance).where(
                Attendance.meetup_id == report.meetup_id,
                Attendance.user_id == report.player_id,
                Attendance.status == "confirmed",
            )
        )
        if not player_att.scalar_one_or_none():
            raise HTTPException(
                status_code=403,
                detail="Player is not a confirmed attendee of this meetup",
            )

    # Upsert: replace existing score for this player+meetup+type
    existing = await db.execute(
        select(MatchScore).where(
            MatchScore.meetup_id == report.meetup_id,
            MatchScore.player_id == report.player_id,
            MatchScore.type == report.type,
        )
    )
    existing_score = existing.scalar_one_or_none()
    if existing_score:
        existing_score.score = report.score
    else:
        new_score = MatchScore(
            meetup_id=report.meetup_id,
            player_id=report.player_id,
            score=report.score,
            type=report.type,
        )
        db.add(new_score)

    await db.commit()
    log_action(
        request,
        "rating",
        "rating.score_reported",
        f"Reported {report.type} score {report.score}/5 for player {report.player_id}",
        meetup_id=report.meetup_id,
    )
    return {"status": "success", "message": "Score reported successfully"}
