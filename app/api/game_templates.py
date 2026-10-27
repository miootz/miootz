"""Admin CRUD for recurring game templates (schedules + defaults for materialized meetups)."""

from __future__ import annotations

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.database import get_db
from app.models.game_template import GameTemplate
from app.models.meetup import Meetup
from app.models.user import User
from app.services.recurrence_scheduler import (
    register_game_template_job,
    unregister_game_template_job,
)
from app.services.recurring_meetups import next_announce_occurrence_utc
from app.core.timeutil import utcnow

router = APIRouter(prefix="/game-templates", tags=["game-templates"])

TEAM_ASSIGNMENT_MODES = frozenset({"balanced", "random"})


def _normalize_team_mode(v: str) -> str:
    x = (v or "balanced").lower().strip()
    if x not in TEAM_ASSIGNMENT_MODES:
        raise ValueError("team_assignment_mode must be 'balanced' or 'random'")
    return x


def _template_json(t: GameTemplate, *, meetup_count: int | None = None) -> dict:
    out = {
        "id": t.id,
        "name": t.name,
        "timezone": t.timezone,
        "weekday": t.weekday,
        "hour": t.hour,
        "minute": t.minute,
        "announce_timezone": t.announce_timezone,
        "announce_weekday": t.announce_weekday,
        "announce_hour": t.announce_hour,
        "announce_minute": t.announce_minute,
        "location": t.location,
        "fee": t.fee,
        "min_players": t.min_players,
        "max_players": t.max_players,
        "latitude": t.latitude,
        "longitude": t.longitude,
        "waitlist_mode": t.waitlist_mode,
        "team_assignment_mode": getattr(t, "team_assignment_mode", None)
        or "balanced",
        "is_active": t.is_active,
        "match_duration_minutes": getattr(t, "match_duration_minutes", None)
        or 10,
        "next_announce_at": (
            next_announce_occurrence_utc(t, utcnow()).isoformat()
            if t.is_active
            else None
        ),
    }
    if meetup_count is not None:
        out["materialized_meetup_count"] = meetup_count
    return out


class GameTemplateCreate(BaseModel):
    name: str = Field(default="Meetup", min_length=1, max_length=200)
    timezone: str = "UTC"
    weekday: int = Field(ge=0, le=6)
    hour: int = Field(ge=0, le=23)
    minute: int = Field(ge=0, le=59)
    announce_timezone: str = "UTC"
    announce_weekday: int = Field(ge=0, le=6)
    announce_hour: int = Field(ge=0, le=23)
    announce_minute: int = Field(ge=0, le=59)
    location: str = Field(min_length=1)
    fee: float = 0.0
    min_players: int = Field(default=10, ge=1, le=50)
    max_players: int = Field(default=15, ge=1, le=50)
    latitude: float | None = None
    longitude: float | None = None
    waitlist_mode: str = Field(default="auto_promote")
    team_assignment_mode: str = Field(default="balanced")
    is_active: bool = True
    match_duration_minutes: int = Field(default=10, ge=1, le=60)

    @field_validator("timezone", "announce_timezone")
    @classmethod
    def tz_ok(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except ZoneInfoNotFoundError as e:
            raise ValueError("Invalid IANA timezone") from e
        return v

    @field_validator("waitlist_mode")
    @classmethod
    def mode_ok(cls, v: str) -> str:
        if v.lower() not in ("broadcast", "auto_promote"):
            raise ValueError("waitlist_mode must be 'broadcast' or 'auto_promote'")
        return v.lower()

    @field_validator("team_assignment_mode")
    @classmethod
    def team_ok(cls, v: str) -> str:
        return _normalize_team_mode(v)

    @model_validator(mode="after")
    def caps(self):
        if self.max_players < self.min_players:
            raise ValueError("max_players must be >= min_players")
        return self


class GameTemplateUpdate(BaseModel):
    name: str | None = None
    timezone: str | None = None
    weekday: int | None = Field(default=None, ge=0, le=6)
    hour: int | None = Field(default=None, ge=0, le=23)
    minute: int | None = Field(default=None, ge=0, le=59)
    announce_timezone: str | None = None
    announce_weekday: int | None = Field(default=None, ge=0, le=6)
    announce_hour: int | None = Field(default=None, ge=0, le=23)
    announce_minute: int | None = Field(default=None, ge=0, le=59)
    location: str | None = None
    fee: float | None = None
    min_players: int | None = Field(default=None, ge=1, le=50)
    max_players: int | None = Field(default=None, ge=1, le=50)
    latitude: float | None = None
    longitude: float | None = None
    waitlist_mode: str | None = None
    team_assignment_mode: str | None = None
    is_active: bool | None = None
    match_duration_minutes: int | None = Field(default=None, ge=1, le=60)

    @field_validator("timezone", "announce_timezone")
    @classmethod
    def tz_ok(cls, v: str | None) -> str | None:
        if v is None:
            return None
        try:
            ZoneInfo(v)
        except ZoneInfoNotFoundError as e:
            raise ValueError("Invalid IANA timezone") from e
        return v

    @field_validator("waitlist_mode")
    @classmethod
    def mode_ok(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if v.lower() not in ("broadcast", "auto_promote"):
            raise ValueError("waitlist_mode must be 'broadcast' or 'auto_promote'")
        return v.lower()

    @field_validator("team_assignment_mode")
    @classmethod
    def team_ok(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return _normalize_team_mode(v)

    @model_validator(mode="after")
    def caps(self):
        mn = self.min_players
        mx = self.max_players
        if mn is not None and mx is not None and mx < mn:
            raise ValueError("max_players must be >= min_players")
        return self


@router.get("/")
async def list_game_templates(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(GameTemplate).order_by(GameTemplate.name.asc()))
    templates = result.scalars().all()
    items = []
    for t in templates:
        n = await db.scalar(
            select(func.count())
            .select_from(Meetup)
            .where(Meetup.game_template_id == t.id)
        )
        items.append(_template_json(t, meetup_count=int(n or 0)))
    return {"items": items}


@router.post("/", status_code=201)
async def create_game_template(
    body: GameTemplateCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    t = GameTemplate(
        name=body.name.strip(),
        timezone=body.timezone,
        weekday=body.weekday,
        hour=body.hour,
        minute=body.minute,
        announce_timezone=body.announce_timezone,
        announce_weekday=body.announce_weekday,
        announce_hour=body.announce_hour,
        announce_minute=body.announce_minute,
        location=body.location.strip(),
        fee=body.fee,
        min_players=body.min_players,
        max_players=body.max_players,
        latitude=body.latitude,
        longitude=body.longitude,
        waitlist_mode=body.waitlist_mode,
        team_assignment_mode=body.team_assignment_mode,
        is_active=body.is_active,
        match_duration_minutes=body.match_duration_minutes,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    if t.is_active:
        register_game_template_job(t)
    return _template_json(t, meetup_count=0)


@router.get("/{template_id}")
async def get_game_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    t = await db.get(GameTemplate, template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    n = await db.scalar(
        select(func.count())
        .select_from(Meetup)
        .where(Meetup.game_template_id == template_id)
    )
    return _template_json(t, meetup_count=int(n or 0))


@router.patch("/{template_id}")
async def update_game_template(
    template_id: int,
    body: GameTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    t = await db.get(GameTemplate, template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()
        if not data["name"]:
            raise HTTPException(status_code=400, detail="name cannot be empty")
    for key, value in data.items():
        setattr(t, key, value)

    await db.commit()
    await db.refresh(t)
    if t.is_active:
        register_game_template_job(t)
    else:
        unregister_game_template_job(t.id)
    n = await db.scalar(
        select(func.count())
        .select_from(Meetup)
        .where(Meetup.game_template_id == template_id)
    )
    return _template_json(t, meetup_count=int(n or 0))


@router.delete("/{template_id}")
async def delete_game_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    t = await db.get(GameTemplate, template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    n = await db.scalar(
        select(func.count())
        .select_from(Meetup)
        .where(Meetup.game_template_id == template_id)
    )
    if n and int(n) > 0:
        raise HTTPException(
            status_code=409,
            detail="This template has materialized meetups. Deactivate it instead, or remove meetups first.",
        )
    unregister_game_template_job(template_id)
    from sqlalchemy import delete

    from app.models.game_template_subscription import GameTemplateSubscription

    await db.execute(
        delete(GameTemplateSubscription).where(
            GameTemplateSubscription.game_template_id == template_id
        )
    )
    await db.delete(t)
    await db.commit()
    return {"status": "deleted"}
