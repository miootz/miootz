from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import utcnow
from app.models.user import User
from app.schemas.rankings import AttributeRankingsResponse, RankingsResponse
from app.services import rankings_service
from app.services.player_attributes import (
    effective_player_attributes,
    load_player_attributes,
)
from app.services.rating_settings import get_rating_settings, selected_rating

router = APIRouter(tags=["rankings"])


async def get_current_authenticated_user(request: Request) -> User:
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return request.state.user


def _ranking_year(year: str | None) -> int | None:
    if year is None:
        return utcnow().year
    if year == "all":
        return None
    try:
        scope = int(year)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="year must be a number or 'all'"
        ) from exc
    if not 1900 <= scope <= 2999:
        raise HTTPException(status_code=400, detail="year out of range")
    return scope


@router.get("/rankings", response_model=RankingsResponse)
async def get_season_rankings(
    request: Request,
    year: str | None = Query(
        default=None,
        description="Calendar year, 'all' for all time, default: current season",
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
    return await rankings_service.get_rankings(
        db,
        year=_ranking_year(year),
        include_own_goals=include_own_goals,
        sort=sort,
        order=order,
        page=page,
        per_page=per_page,
    )


@router.get("/rankings/attributes", response_model=AttributeRankingsResponse)
async def get_attribute_rankings(
    year: str | None = None,
    sort: Literal["rating", "sho", "pas", "def"] = "rating",
    order: Literal["asc", "desc"] = "desc",
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
    _: User = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
):
    scope = _ranking_year(year)
    computed_scores = (await get_rating_settings(db)).computed_scores
    if computed_scores:
        attributes = await load_player_attributes(db, year=scope)
        eligible = or_(
            User.calculated_skill.is_not(None),
            User.id.in_(attributes),
            User.sho_override.is_not(None),
            User.pas_override.is_not(None),
            User.def_override.is_not(None),
        )
    else:
        attributes = {}
        eligible = User.seed_skill.is_not(None)
        sort = "rating"
    users = await db.scalars(select(User).where(eligible))
    rows = [
        {
            "user": {
                "id": user.id,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
            },
            "rating": selected_rating(user, computed_scores),
            **(
                {
                    key: evidence["score"]
                    for key, evidence in effective_player_attributes(
                        user, attributes.get(user.id)
                    ).items()
                }
                if computed_scores
                else {"sho": None, "pas": None, "def": None}
            ),
        }
        for user in users
    ]
    direction = -1 if order == "desc" else 1
    rows.sort(
        key=lambda row: (
            row[sort] is None,
            direction * (row[sort] or 0),
            row["user"]["display_name"].casefold(),
            row["user"]["id"],
        )
    )
    start = (page - 1) * per_page
    return {
        "computed_scores": computed_scores,
        "total": len(rows),
        "rows": [
            {**row, "rank": index if row[sort] is not None else None}
            for index, row in enumerate(rows[start : start + per_page], start + 1)
        ],
    }


@router.get("/meetups/{meetup_id}/rankings", response_model=RankingsResponse)
async def get_meetup_rankings(
    meetup_id: int,
    _: User = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
):
    """Per-meetup top performers for the history page (own goals included)."""
    result = await rankings_service.get_meetup_rankings(db, meetup_id)
    if result is None:
        raise HTTPException(
            status_code=404, detail="No completed matches for this meetup"
        )
    return result
