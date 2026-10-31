from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import utcnow
from app.models.user import User
from app.schemas.rankings import RankingsResponse
from app.services import rankings_service

router = APIRouter(tags=["rankings"])


async def get_current_authenticated_user(request: Request) -> User:
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return request.state.user


@router.get("/rankings", response_model=RankingsResponse)
async def get_season_rankings(
    request: Request,
    year: str | None = Query(
        default=None, description="Calendar year, 'all' for all time, default: current season"
    ),
    include_own_goals: bool = False,
    sort: str = "attendances",
    order: str = "desc",
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
    _: User = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
):
    """Season/all-time player rankings. Default scope is the current season."""
    if year is None:
        scope = utcnow().year
    elif year == "all":
        scope = None
    else:
        try:
            scope = int(year)
        except ValueError:
            raise HTTPException(status_code=400, detail="year must be a number or 'all'")
        if not 1900 <= scope <= 2999:
            raise HTTPException(status_code=400, detail="year out of range")
    return await rankings_service.get_rankings(
        db,
        year=scope,
        include_own_goals=include_own_goals,
        sort=sort,
        order=order,
        page=page,
        per_page=per_page,
    )


@router.get("/meetups/{meetup_id}/rankings", response_model=RankingsResponse)
async def get_meetup_rankings(
    meetup_id: int,
    _: User = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
):
    """Per-meetup top performers for the history page (own goals included)."""
    result = await rankings_service.get_meetup_rankings(db, meetup_id)
    if result is None:
        raise HTTPException(status_code=404, detail="No completed matches for this meetup")
    return result
