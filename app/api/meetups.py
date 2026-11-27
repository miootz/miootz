from datetime import datetime, timedelta, timezone
import asyncio
import hashlib
import logging
import secrets

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi.responses import StreamingResponse
import json
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.api.deps import PRESENCE_HEAD_MINUTES, require_admin
from app.api.matches import _compute_timer_remaining, _is_currently_paused

# slowapi limiter instance shared with main.py (bucket key: user id or client IP)
from app.api.rate_limit import (
    LIMIT_MUTATION,
    LIMIT_PUBLIC,
    LIMIT_SSE,
    LIMIT_WRITE,
    limiter,
)
from app.core.database import get_db
from app.core.json_column import loads_int_list
from app.models.game_template import GameTemplate
from app.models.meetup import Meetup, Attendance, MatchScore
from app.models.match import MeetupMatch
from app.models.award import WeatherHeroAward
from app.models.user import User
from app.models.chat import ChatMessage, ChatReceipt
from app.models.guest_plus_one import GuestPlusOne
from app.models.rating import Rating
from app.core.chat_manager import chat_manager
from app.services.skill_service import (
    recalculate_skills_for_attendance_change,
    refresh_player_skills,
    update_user_calculated_skill,
)
from app.core.meetup_data_manager import meetup_data_manager
from app.services.meetup_promotion import handle_leave_or_cancel
from app.services.meetup_signup import (
    active_hold_times,
    find_signup_hold,
    open_signup_hold,
    read_signup_hold_token,
    signup_status,
)
from app.services.meetup_revision import (
    bump_meetup_revision,
    notify_meetup_data_changed,
    notify_meetup_deleted,
    notify_meetup_list_changed,
)
from app.services.manual_teams import (
    ensure_team_names,
    format_teams_api_payload,
    get_team_names,
    resolve_meetup_teams_nested,
    validate_team_partition,
    build_teams_from_manual,
)
from app.services.team_adjustment import (
    expand_teams,
    contract_teams,
    refresh_after_confirmed_roster_change,
)
from app.services.team_assignment import draft_skill, rebalance_around_locked
from app.services.rating_settings import get_rating_settings, selected_rating
from app.services.rankings_service import meetup_winning_teams
from app.services.team_names import generate_team_names
from app.services.web_push import (
    notify_new_meetup_invites,
    notify_meetup_cancelled_recipients,
    notify_demoted_to_waitlist,
)
from app.services.recurring_meetups import (
    materialize_next_meetup,
    notify_new_meetup,
    next_announce_occurrence_utc,
)
from app.services import weather_service
from app.core.timeutil import to_utc, utcnow
from app.services.audit import log_action

router = APIRouter(prefix="/meetups", tags=["meetups"])

TEAM_ASSIGNMENT_MODES = frozenset({"auto-balanced", "balanced", "random"})


def _normalize_team_mode(v: str) -> str:
    x = (v or "balanced").lower().strip()
    if x not in TEAM_ASSIGNMENT_MODES:
        raise ValueError("team_assignment_mode must be 'auto-balanced', 'balanced', or 'random'")
    return x


class MeetupCreate(BaseModel):
    start_time: datetime
    location: str
    fee: float = 0.0
    fee_text: str | None = None
    min_players: int = Field(default=10, ge=1, le=50)
    max_players: int = Field(default=15, ge=1, le=50)
    latitude: float | None = None
    longitude: float | None = None
    waitlist_mode: str = Field(default="auto_promote")
    team_assignment_mode: str = Field(default="auto-balanced")
    #: When True (default), push all users a join notification for this instance.
    send_push_notifications: bool = True
    #: Upper bound on team count. When None, team count is purely algorithmic.
    max_teams: int | None = None

    @field_validator("waitlist_mode")
    @classmethod
    def mode_ok(cls, v: str) -> str:
        if v.lower() not in ("broadcast", "auto_promote"):
            raise ValueError("waitlist_mode must be 'broadcast' or 'auto_promote'")
        return v.lower()

    @field_validator("team_assignment_mode")
    @classmethod
    def team_mode_create(cls, v: str) -> str:
        return _normalize_team_mode(v)

    @model_validator(mode="after")
    def caps(self):
        if self.max_players < self.min_players:
            raise ValueError("max_players must be >= min_players")
        return self


class MeetupUpdate(BaseModel):
    start_time: datetime | None = None
    location: str | None = None
    fee: float | None = None
    fee_text: str | None = None
    min_players: int | None = Field(default=None, ge=1, le=50)
    max_players: int | None = Field(default=None, ge=1, le=50)
    latitude: float | None = None
    longitude: float | None = None
    waitlist_mode: str | None = None
    team_assignment_mode: str | None = None

    @field_validator("team_assignment_mode")
    @classmethod
    def team_mode_update(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return _normalize_team_mode(v)


class TeamsUpdateBody(BaseModel):
    """Confirmed user ids grouped by team (same sizes as automatic snake draft)."""

    teams: list[list[str]]


class TeamsReshuffleBody(BaseModel):
    """Optional: current lineup + locked ids for a locked-aware rebalance."""

    teams: list[list[str]] = []
    locked: list[str] = []


class TeamsAdjustBody(BaseModel):
    """Expand or contract teams, auto-promoting/returning waitlisted players."""

    operation: str  # "expand" | "contract"
    num_teams: int = 1


class TeamsReshapeBody(BaseModel):
    """Set the team shape and signup capacity."""

    team_count: int = Field(ge=2, le=5)
    team_size: int = Field(ge=2, le=15)


class ChatMessageCreate(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class ChatTypingBody(BaseModel):
    typing: bool = True


class ChatReceiptUpdate(BaseModel):
    delivered_id: int = Field(ge=1)
    read_id: int | None = Field(default=None, ge=1)


class PlusOneCreate(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=80)
    last_name: str = Field(..., min_length=1, max_length=80)
    #: Seeded skill for the guest's computed rating (1–5).
    skill: float = Field(..., ge=1, le=5, multiple_of=0.5)


class PlusOneClaim(BaseModel):
    """Claim a plus-one guest reservation.

    The guest must already have a Pocket ID account.
    Their pocket_id_sub is extracted from the auth middleware.
    """


def _location_day_started(start_time: datetime, tz_name: str | None, now: datetime) -> bool:
    """True while the meetup's local date (location timezone) is today or later.

    ``start_time`` is naive UTC; the window runs from midnight of the previous
    day in the location tz (template timezone, UTC for one-off meetups) through
    the end of the meetup's own day."""
    try:
        tz = ZoneInfo(tz_name or "UTC")
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")
    local = start_time.replace(tzinfo=timezone.utc).astimezone(tz)
    now_local = now.replace(tzinfo=timezone.utc).astimezone(tz)
    return local.date() >= now_local.date()


def _name_color(name: str) -> str:
    """Deterministic pastel color from display name for chat bubbles.

    Uses blake2b instead of ``hash()`` — Python's str hash is salted per
    process, so colors would change on every server restart / worker."""
    digest = hashlib.blake2b(name.encode(), digest_size=3).digest()
    r, g, b = digest[0], digest[1], digest[2]
    return f"#{(r ^ 0x40):02x}{(g ^ 0x30):02x}{(b ^ 0x50):02x}"


async def _signup_attendance(
    db: AsyncSession, meetup: Meetup, user_id: int, attendance: Attendance | None,
    *, reservation_id: int | None = None, respect_waitlist: bool = True,
) -> Attendance:
    now = utcnow()
    hold = await find_signup_hold(db, meetup.id, user_id)
    active = hold is not None and not hold.settled and hold.expires_at > now
    if reservation_id is not None and (not active or hold.id != reservation_id):
        raise HTTPException(status_code=409, detail="Your signup hold expired or belongs to another account.")
    joined_at = hold.started_at if active else now
    status = await signup_status(db, meetup, joined_at, now, respect_waitlist=respect_waitlist)
    if attendance is None:
        attendance = Attendance(meetup_id=meetup.id, user_id=user_id)
        db.add(attendance)
    attendance.status = status
    attendance.previous_status = None
    attendance.joined_at = joined_at
    if active:
        hold.settled = True
    await db.flush()
    return attendance


def _game_template_json(t: GameTemplate | None) -> dict | None:
    if not t:
        return None
    next_announce = next_announce_occurrence_utc(t, utcnow()) if t.is_active else None
    return {
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
        "is_active": t.is_active,
        "team_assignment_mode": getattr(t, "team_assignment_mode", None) or "balanced",
        "allows_draws": getattr(t, "allows_draws", False),
        "next_announce_at": next_announce.isoformat() if next_announce else None,
    }


@router.post("/", status_code=201)
async def create_meetup(
    meetup_data: MeetupCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    payload = meetup_data.model_dump(exclude={"send_push_notifications"})
    new_meetup = Meetup(**payload, game_template_id=None)
    # Team count follows the same heuristic as the migrations backfill:
    # 3 teams for full-fifths-sized meetups (max_players >= 13), else 2.
    ensure_team_names(new_meetup, 3 if (new_meetup.max_players or 15) >= 13 else 2)
    db.add(new_meetup)
    await db.flush()
    await db.commit()
    await db.refresh(new_meetup)
    await notify_meetup_list_changed()
    log_action(
        request,
        "meetup",
        "meetup.created",
        "Created meetup "
        f"({new_meetup.min_players}-{new_meetup.max_players} players)",
        meetup_id=new_meetup.id,
        meetup_start_time=new_meetup.start_time,
    )

    if meetup_data.send_push_notifications:
        result = await db.execute(select(User))
        all_users = result.scalars().all()
        if all_users:
            await notify_new_meetup_invites(db, new_meetup, list(all_users))

    # Queue rating reminder at meetup end time (durable job queue)
    from app.services.rating_reminder_scheduler import register_rating_reminder

    await register_rating_reminder(db, new_meetup)

    return {
        "id": new_meetup.id,
        "start_time": new_meetup.start_time,
        "location": new_meetup.location,
        "fee": new_meetup.fee,
        "fee_text": new_meetup.fee_text,
        "min_players": new_meetup.min_players,
        "max_players": new_meetup.max_players,
        "latitude": new_meetup.latitude,
        "longitude": new_meetup.longitude,
        "waitlist_mode": new_meetup.waitlist_mode,
        "team_assignment_mode": getattr(new_meetup, "team_assignment_mode", None)
        or "balanced",
        "content_revision": new_meetup.content_revision or 0,
        "game_template_id": new_meetup.game_template_id,
        "game_template": None,
    }


@router.get("/")
async def list_meetups(
    db: AsyncSession = Depends(get_db),
    limit: int | None = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
    status: str | None = Query(
        None, description="Filter by time: past | upcoming | all (default)"
    ),
    order: str = Query(
        "asc",
        description="Sort by start_time: asc | desc",
    ),
    q: str | None = Query(None, description="Filter by location (contains)"),
):
    now = utcnow()

    # Order direction via explicit allowlist (no dynamic identifiers).
    order_exprs = {
        "asc": (Meetup.start_time.asc(), Meetup.id.asc()),
        "desc": (Meetup.start_time.desc(), Meetup.id.desc()),
    }
    o = order.lower()
    if o not in order_exprs:
        raise HTTPException(status_code=400, detail="Invalid order")

    # Build both queries with the same parameterized filters.
    count_stmt = select(func.count()).select_from(Meetup)
    stmt = select(Meetup).options(selectinload(Meetup.game_template))

    # Skipped meetups leave no trace in any listing (past, upcoming, all).
    count_stmt = count_stmt.where(Meetup.skipped.is_(False))
    stmt = stmt.where(Meetup.skipped.is_(False))

    if q and (q := q.strip()):
        count_stmt = count_stmt.where(Meetup.location.contains(q))
        stmt = stmt.where(Meetup.location.contains(q))
    if status == "past":
        count_stmt = count_stmt.where(Meetup.start_time < now)
        stmt = stmt.where(Meetup.start_time < now)
    elif status == "upcoming":
        count_stmt = count_stmt.where(Meetup.start_time >= now)
        stmt = stmt.where(Meetup.start_time >= now)
    elif status not in (None, "all"):
        raise HTTPException(status_code=400, detail="Invalid status filter")

    total = (await db.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(*order_exprs[o]).offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    meetups = result.scalars().all()
    if not meetups:
        return {
            "items": [],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    meetup_ids = [s.id for s in meetups]
    counts_result = await db.execute(
        select(Attendance.meetup_id, func.count(Attendance.id))
        .where(
            Attendance.meetup_id.in_(meetup_ids),
            Attendance.status == "confirmed",
        )
        .group_by(Attendance.meetup_id)
    )
    confirmed_by_meetup = {row[0]: row[1] for row in counts_result.all()}

    items = [
        {
            "id": s.id,
            "start_time": s.start_time,
            "duration_minutes": s.duration_minutes,
            "location": s.location,
            "fee": s.fee,
            "fee_text": s.fee_text,
            "min_players": s.min_players,
            "max_players": s.max_players,
            "latitude": s.latitude,
            "longitude": s.longitude,
            "waitlist_mode": s.waitlist_mode,
            "team_assignment_mode": getattr(s, "team_assignment_mode", None)
            or "balanced",
            "content_revision": s.content_revision or 0,
            "game_template_id": s.game_template_id,
            "game_template": _game_template_json(s.game_template),
            "confirmed_count": confirmed_by_meetup.get(s.id, 0),
            # Admin overview "current" flag: the meetup's local date (location
            # tz) is today or later.
            "is_current": _location_day_started(
                s.start_time,
                s.game_template.timezone if s.game_template else None,
                now,
            ),
        }
        for s in meetups
    ]
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{meetup_id}")
async def get_meetup(
    meetup_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Meetup)
        .options(selectinload(Meetup.game_template))
        .where(Meetup.id == meetup_id)
    )
    meetup = result.scalar_one_or_none()
    if not meetup or meetup.skipped:
        raise HTTPException(status_code=404, detail="Meetup not found")

    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(Attendance.meetup_id == meetup_id)
        .order_by(Attendance.joined_at, Attendance.id)
    )
    rows = result.all()
    computed_scores = (await get_rating_settings(db)).computed_scores

    # Resolve which attendees are plus-one guests
    plus_one_user_ids: set[int] = set()
    if rows:
        user_ids = [u.id for _, u in rows]
        po_result = await db.execute(
            select(GuestPlusOne.guest_user_id).where(
                GuestPlusOne.meetup_id == meetup_id,
                GuestPlusOne.guest_user_id.in_(user_ids),
            )
        )
        plus_one_user_ids = {row[0] for row in po_result.all()}

    attendees = []
    for att, user in rows:
        attendees.append(
            {
                "attendance_id": att.id,
                "user_id": user.id,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
                "status": att.status,
                "joined_at": att.joined_at.isoformat() if att.joined_at else None,
                "skill": draft_skill(selected_rating(user, computed_scores)),
                "calculated_skill": selected_rating(user, computed_scores),
                "pac": user.pac,
                "dri": user.dri,
                "is_plus_one": user.id in plus_one_user_ids,
                "primary_specialty": user.primary_specialty,
                "secondary_specialty": user.secondary_specialty,
            }
        )

    my_attendance = None
    my_waitlist_position = None
    my_weather_hero_unused = 0
    user = getattr(request.state, "user", None)
    if user is not None:
        for att, u in rows:
            if u.id == user.id:
                my_attendance = att.status
                break
        if my_attendance == "waitlisted":
            waitlist = [att.user_id for att, _ in rows if att.status == "waitlisted"]
            my_waitlist_position = waitlist.index(user.id) + 1
            holds = await active_hold_times(db, meetup_id, utcnow())
            if holds:
                earlier_holds = sum(at < att.joined_at for at in holds)
                confirmed = sum(row.status == "confirmed" for row, _ in rows)
                vacancies = max(0, meetup.max_players - confirmed)
                if earlier_holds:
                    my_waitlist_position = max(1, my_waitlist_position + earlier_holds - vacancies)
        my_weather_hero_unused = (
            await db.execute(
                select(func.count(WeatherHeroAward.id)).where(
                    WeatherHeroAward.user_id == user.id,
                    WeatherHeroAward.used_at.is_(None),
                )
            )
        ).scalar_one()

    weather_hero_granted = (
        (
            await db.execute(
                select(func.count(WeatherHeroAward.id)).where(
                    WeatherHeroAward.granted_meetup_id == meetup_id
                )
            )
        )
        .scalar_one()
        > 0
    )

    # Current active/pending match
    current_match = None
    result = await db.execute(
        select(MeetupMatch)
        .where(MeetupMatch.meetup_id == meetup_id)
        .where(MeetupMatch.status.in_(["active", "time_up", "pending"]))
        .order_by(MeetupMatch.match_number.desc())
        .limit(1)
    )
    active_match = result.scalar_one_or_none()
    has_started = (
        await db.execute(
            select(MeetupMatch.id)
            .where(
                MeetupMatch.meetup_id == meetup_id,
                MeetupMatch.status.in_(["active", "time_up", "completed"]),
            )
            .limit(1)
        )
    ).scalar_one_or_none() is not None
    if active_match:
        team_a_users = loads_int_list(active_match.team_a_users)
        team_b_users = loads_int_list(active_match.team_b_users)
        # Build from existing attendee data
        attendee_map = {a["user_id"]: a for a in attendees}

        def _user_list(ids):
            out = []
            for uid in ids:
                a = attendee_map.get(uid)
                if a:
                    out.append(
                        {
                            "id": uid,
                            "display_name": a["display_name"],
                            "avatar_url": a["avatar_url"],
                            "pac": a["pac"],
                            "dri": a["dri"],
                        }
                    )
                else:
                    out.append(
                        {"id": uid, "display_name": f"User {uid}", "avatar_url": None}
                    )
            return out

        current_match = {
            "id": active_match.id,
            "match_number": active_match.match_number,
            "team_a": {
                "name": active_match.team_a_name,
                "users": _user_list(team_a_users),
            },
            "team_b": {
                "name": active_match.team_b_name,
                "users": _user_list(team_b_users),
            },
            "score_a": active_match.score_a,
            "score_b": active_match.score_b,
            "status": active_match.status,
            "timer_total_seconds": active_match.timer_total_seconds,
            # Live value (the stored column only updates at start/pause/resume).
            "timer_seconds_remaining": _compute_timer_remaining(active_match),
            "timer_paused": _is_currently_paused(active_match),
        }

    return {
        "id": meetup.id,
        "start_time": meetup.start_time,
        "location": meetup.location,
        "fee": meetup.fee,
        "fee_text": meetup.fee_text,
        "min_players": meetup.min_players,
        "max_players": meetup.max_players,
        "latitude": meetup.latitude,
        "longitude": meetup.longitude,
        "waitlist_mode": meetup.waitlist_mode,
        "team_assignment_mode": getattr(meetup, "team_assignment_mode", None)
        or "balanced",
        "content_revision": meetup.content_revision or 0,
        "game_template_id": meetup.game_template_id,
        "game_template": _game_template_json(meetup.game_template),
        "duration_minutes": meetup.duration_minutes,
        "max_teams": meetup.max_teams,
        "team_size": meetup.team_size,
        "has_started": has_started,
        "attendees": attendees,
        "my_attendance": my_attendance,
        "my_waitlist_position": my_waitlist_position,
        "my_weather_hero_unused": my_weather_hero_unused,
        "weather_hero_granted": weather_hero_granted,
        "current_match": current_match,
    }


@router.get("/{meetup_id}/history-summary")
async def get_meetup_history_summary(
    meetup_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    """Completed match count, meetup winners and the viewer's average vote."""
    user = getattr(request.state, "user", None)
    result = await db.execute(
        select(MeetupMatch)
        .where(MeetupMatch.meetup_id == meetup_id)
        .where(MeetupMatch.status == "completed")
    )
    matches = list(result.scalars())
    my_rating_avg = None
    if user is not None:
        r = await db.execute(
            select(Rating.score)
            .where(Rating.meetup_id == meetup_id)
            .where(Rating.rater_id == user.id)
            .where(Rating.score.between(1, 5))
        )
        scores = [row[0] for row in r.all()]
        if scores:
            my_rating_avg = sum(scores) / len(scores)
    return {
        "match_count": len(matches),
        "winning_teams": await meetup_winning_teams(db, matches),
        "my_rating_avg": my_rating_avg,
    }


@router.get("/{meetup_id}/teams")
async def get_meetup_teams(meetup_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(
            Attendance.meetup_id == meetup_id,
            Attendance.status == "confirmed",
        )
    )
    rows = result.all()
    computed_scores = (await get_rating_settings(db)).computed_scores
    players = [
        {
            "id": str(user.id),
            "name": user.display_name,
            "skill": draft_skill(selected_rating(user, computed_scores)),
            "user_id": user.id,
            "avatar_url": user.avatar_url,
            "primary_specialty": user.primary_specialty,
            "secondary_specialty": user.secondary_specialty,
            "calculated_skill": selected_rating(user, computed_scores),
            "pac": user.pac,
            "dri": user.dri,
        }
        for _, user in rows
    ]
    mode = getattr(meetup, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_meetup_teams_nested(
        getattr(meetup, "manual_teams_json", None),
        mode,
        players,
        max_teams=getattr(meetup, "max_teams", None),
        team_size=meetup.team_size,
    )
    team_names = get_team_names(meetup)
    out = format_teams_api_payload(teams_nested, team_names)
    return {
        "meetup_id": meetup_id,
        "content_revision": meetup.content_revision or 0,
        "teams": out,
    }


@router.get("/{meetup_id}/scores")
async def get_meetup_scores(meetup_id: int, db: AsyncSession = Depends(get_db)):
    """Get all match scores for a meetup."""
    result = await db.execute(
        select(MatchScore, User)
        .join(User, MatchScore.player_id == User.id)
        .where(MatchScore.meetup_id == meetup_id)
        .order_by(User.sso_display_name.asc(), User.pocket_id_sub.asc())
    )
    rows = result.all()
    return [
        {
            "id": ms.id,
            "player_id": ms.player_id,
            "display_name": user.display_name,
            "score": ms.score,
            "type": ms.type,
        }
        for ms, user in rows
    ]


@router.patch("/{meetup_id}/teams")
async def patch_meetup_teams(
    meetup_id: int,
    body: TeamsUpdateBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Persist admin team lineups (confirmed roster only)."""
    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(
            Attendance.meetup_id == meetup_id,
            Attendance.status == "confirmed",
        )
    )
    rows = result.all()
    computed_scores = (await get_rating_settings(db)).computed_scores
    players = [
        {
            "id": str(user.id),
            "name": user.display_name,
            "skill": draft_skill(selected_rating(user, computed_scores)),
            "user_id": user.id,
            "avatar_url": user.avatar_url,
            "calculated_skill": selected_rating(user, computed_scores),
            "pac": user.pac,
            "dri": user.dri,
        }
        for _, user in rows
    ]
    confirmed_ids = {p["user_id"] for p in players}
    try:
        int_teams = [[int(x) for x in team] for team in body.teams]
    except TypeError, ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid user id in teams"
        ) from None

    if not validate_team_partition(
        int_teams, confirmed_ids, max_teams=meetup.max_teams
    ):
        raise HTTPException(
            status_code=400,
            detail="Teams must partition all confirmed players with valid team sizes",
        )

    meetup.manual_teams_json = json.dumps(int_teams)
    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    log_action(
        request,
        "teams",
        "teams.lineup_saved",
        f"Saved team lineups "
        f"({len(int_teams)} teams, {len(confirmed_ids)} players)",
        meetup_id=meetup_id,
    )

    teams_nested = build_teams_from_manual(players, int_teams)
    out = format_teams_api_payload(teams_nested)
    return {
        "meetup_id": meetup_id,
        "content_revision": rev or 0,
        "teams": out,
    }


@router.post("/{meetup_id}/teams/reshuffle")
async def reshuffle_meetup_teams(
    meetup_id: int,
    request: Request,
    body: TeamsReshuffleBody | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Reshuffle teams.

    Without a body: full redraw (only when `team_assignment_mode` is
    `random`). With a body: locked players keep their spots and the rest
    is rebalanced around them (both modes); the result is persisted as
    the manual lineup.
    """
    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")
    mode = getattr(meetup, "team_assignment_mode", None) or "balanced"

    if not body or not body.teams:
        if mode != "random":
            raise HTTPException(
                status_code=400,
                detail="Reshuffle only applies when team_assignment_mode is random",
            )
        meetup.manual_teams_json = None
    else:
        result = await db.execute(
            select(Attendance, User)
            .join(User, Attendance.user_id == User.id)
            .where(
                Attendance.meetup_id == meetup_id,
                Attendance.status == "confirmed",
            )
        )
        rows = result.all()
        computed_scores = (await get_rating_settings(db)).computed_scores
        players = [
            {
                "id": str(user.id),
                "skill": draft_skill(selected_rating(user, computed_scores)),
                "user_id": user.id,
                "pac": user.pac,
                "dri": user.dri,
            }
            for _, user in rows
        ]
        confirmed_ids = {p["user_id"] for p in players}
        try:
            int_teams = [[int(x) for x in team] for team in body.teams]
        except TypeError, ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid user id in teams"
            ) from None
        if not validate_team_partition(
            int_teams, confirmed_ids, max_teams=meetup.max_teams
        ):
            raise HTTPException(
                status_code=400,
                detail="Teams must partition all confirmed players with valid team sizes",
            )
        try:
            locked = {int(x) for x in body.locked}
        except TypeError, ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid user id in locked"
            ) from None
        if not locked <= confirmed_ids:
            raise HTTPException(
                status_code=400, detail="Locked user is not confirmed"
            )
        rebalanced = rebalance_around_locked(
            players,
            int_teams,
            locked,
            max_teams=meetup.max_teams,
            randomize=(mode == "random"),
            optimize=mode == "auto-balanced",
        )
        new_lineup = [[p["user_id"] for p in team] for team in rebalanced]
        if new_lineup == int_teams:
            # No alternative layout under the current rules (e.g. every
            # rating is unique and nothing is locked) — nothing to persist.
            return {
                "status": "already_balanced",
                "content_revision": meetup.content_revision,
            }
        meetup.manual_teams_json = json.dumps(new_lineup)

    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    log_action(
        request,
        "teams",
        "teams.reshuffled",
        "Reshuffled teams "
        + ("(full redraw)"
           if not body or not body.teams
           else f"(rebalanced around {len(body.locked)} locked players)"),
        meetup_id=meetup_id,
    )
    return {"status": "reshuffled", "content_revision": rev}


@router.post("/{meetup_id}/teams/adjust")
async def adjust_meetup_teams(
    meetup_id: int,
    body: TeamsAdjustBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Expand or contract teams, auto-promoting/returning waitlisted players.

    - **expand**: adds *num_teams* teams and promotes waitlisted players (FIFO by joined_at).
    - **contract**: removes *num_teams* teams and returns excess confirmed players to waitlist (LIFO).
    """
    await db.execute(text("BEGIN IMMEDIATE"))
    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    op = body.operation.lower().strip()
    if op not in ("expand", "contract"):
        raise HTTPException(
            status_code=400, detail="operation must be 'expand' or 'contract'"
        )
    if body.num_teams < 1:
        raise HTTPException(status_code=400, detail="num_teams must be >= 1")

    if op == "expand":
        outcome = await expand_teams(db, meetup, body.num_teams)
    else:
        outcome = await contract_teams(db, meetup, body.num_teams)

    if "error" in outcome:
        raise HTTPException(status_code=400, detail=outcome["error"])

    promoted = outcome.get("promoted", [])
    returned = outcome.get("returned", [])
    log_action(
        request,
        "teams",
        "teams.adjusted",
        f"{'Expanded' if op == 'expand' else 'Contracted'} teams "
        f"by {body.num_teams} team(s)"
        + (f"; promoted: {', '.join(promoted)}" if promoted else "")
        + (f"; back to waitlist: {', '.join(returned)}" if returned else ""),
        meetup_id=meetup_id,
    )
    return outcome


@router.post("/{meetup_id}/teams/reshape")
async def reshape_meetup_teams(
    meetup_id: int,
    body: TeamsReshapeBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Set signup capacity and reshape teams while preserving match history."""
    await db.execute(text("BEGIN IMMEDIATE"))
    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    started = (
        await db.execute(
            select(MeetupMatch.id)
            .where(
                MeetupMatch.meetup_id == meetup_id,
                MeetupMatch.status.in_(["active", "time_up", "completed"]),
            )
            .limit(1)
        )
    ).scalar_one_or_none() is not None
    preserve_confirmed = (
        started or meetup.start_time <= utcnow() + timedelta(minutes=PRESENCE_HEAD_MINUTES)
    )
    capacity = body.team_count * body.team_size
    if not preserve_confirmed and not meetup.min_players <= capacity <= 50:
        raise HTTPException(
            status_code=400,
            detail=f"Signup capacity must be between {meetup.min_players} and 50 players",
        )
    signup_capacity = max(meetup.min_players, min(capacity, 50))

    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(
            Attendance.meetup_id == meetup_id,
            Attendance.status.in_(["confirmed", "waitlisted"]),
        )
        .order_by(Attendance.joined_at, Attendance.id)
    )
    rows = result.all()
    confirmed = [(att, user) for att, user in rows if att.status == "confirmed"]
    waitlisted = [(att, user) for att, user in rows if att.status == "waitlisted"]
    if not preserve_confirmed and len(confirmed) > signup_capacity:
        for att, _ in confirmed[signup_capacity:]:
            att.status = "waitlisted"
        confirmed = confirmed[:signup_capacity]
    else:
        holds = await active_hold_times(db, meetup_id, utcnow())
        for att, user in waitlisted:
            earlier_holds = sum(at < att.joined_at for at in holds)
            if len(confirmed) + earlier_holds >= signup_capacity:
                break
            att.status = "confirmed"
            confirmed.append((att, user))

    computed_scores = (await get_rating_settings(db)).computed_scores
    players = [
        {
            "id": str(user.id),
            "name": user.display_name,
            "skill": draft_skill(selected_rating(user, computed_scores)),
            "user_id": user.id,
            "avatar_url": user.avatar_url,
            "primary_specialty": user.primary_specialty,
            "secondary_specialty": user.secondary_specialty,
            "calculated_skill": selected_rating(user, computed_scores),
            "pac": user.pac,
            "dri": user.dri,
        }
        for _, user in confirmed
    ]

    mode = getattr(meetup, "team_assignment_mode", None) or "balanced"
    # N×M playing slots + ONE bench team with everyone else (possibly
    # incomplete). Redraft around empty "locks" so the skill-sorted (or
    # shuffled) snake fills the exact target sizes.
    ordered = sorted(players, key=lambda p: float(p["skill"]), reverse=True)
    if mode == "random":
        import random as _random

        _random.shuffle(ordered)
    playing = min(len(ordered), capacity)
    per_team, extra = divmod(playing, body.team_count)
    chunks: list[list[int]] = []
    offset = 0
    for i in range(body.team_count):
        count = per_team + (i < extra)
        if count:
            chunks.append([p["user_id"] for p in ordered[offset : offset + count]])
        offset += count
    leftover = [p["user_id"] for p in ordered[capacity:]]
    if leftover:
        chunks.append(leftover)
    rebalanced = rebalance_around_locked(
        players, chunks, locked=set(), max_teams=body.team_count, randomize=(mode == "random"),
        optimize=mode == "auto-balanced", shuffle_equal=mode != "auto-balanced",
    )
    partition = [[p["user_id"] for p in team] for team in rebalanced] if players else []

    # Fresh names: a reshaped team is a NEW team. Old names belong to the old
    # lineups (which live on in completed matches), so stats read correctly.
    team_names = generate_team_names(max(body.team_count, len(partition)))
    meetup.team_names_json = json.dumps(team_names)
    meetup.manual_teams_json = json.dumps(partition)
    meetup.max_teams = body.team_count
    meetup.team_size = body.team_size
    meetup.max_players = signup_capacity

    # Only the opening round has automatic parallel pitches. Later matches
    # keep their own history and are never repurposed as a second pitch.
    matches = list(await db.scalars(
        select(MeetupMatch)
        .where(MeetupMatch.meetup_id == meetup_id)
        .order_by(MeetupMatch.match_number)
    ))
    first = next((m for m in matches if m.match_number == 1), None)
    second = next((m for m in matches if m.pitch == 2), None)
    if first and second is None and len(matches) == 2:
        legacy = matches[1]
        # Older demo fixtures did not mark the simultaneous opening pair.
        if (first.status == "pending" and legacy.match_number == 2
                and legacy.status == "pending" and legacy.pitch is None
                and not legacy.auto_queued):
            second = legacy

    opening_only = bool(
        first and all(m.id == first.id or (second and m.id == second.id) for m in matches)
    )
    opening_matches = [m for m in (first, second) if m is not None] if opening_only else []
    playing_teams = [team for team in partition[:body.team_count] if team]
    has_second_pitch = body.team_count >= 4 and len(playing_teams) >= 4

    async def has_recorded_events(match: MeetupMatch) -> bool:
        from app.models.match import MatchPenalty, MatchSubstitution, PenaltyMiss
        from app.models.match_goal import MatchGoal

        if (match.score_a or match.score_b or match.score_offset_a or match.score_offset_b
                or match.timer_started_at is not None):
            return True
        for model in (MatchGoal, MatchPenalty, PenaltyMiss, MatchSubstitution):
            if await db.scalar(select(model.id).where(model.match_id == match.id).limit(1)):
                return True
        return False

    # Never discard a running, completed, or already recorded match.
    if second and opening_only and body.team_count < 4 and second.status == "pending":
        if not await has_recorded_events(second):
            from app.services.deletes import delete_match_children

            await delete_match_children(db, second.id)
            await db.delete(second)
            await db.flush()
            matches.remove(second)
            opening_matches.remove(second)
            second = None
            meetup.two_pitch = False
            first.pitch = None

    if first and opening_only and second is None and body.team_count < 4:
        # The other pitch may have been deleted manually before reshaping.
        meetup.two_pitch = False
        first.pitch = None

    # Reshape the playing sides. On a live pitch keep that match's lineup
    # intact and fill the other pitch using confirmed players not on it.
    live = next((m for m in opening_matches if m.status in ("active", "time_up")), None)
    if first and first.status == "pending" and await has_recorded_events(first) and live is None:
        live = first
    completed_opening = any(m.status == "completed" for m in opening_matches)
    protected_second = bool(second and second.status == "pending" and await has_recorded_events(second))
    free_sides: list[list[int]] = []
    if (live is not None and live is first and not completed_opening and has_second_pitch
            and (second is None or (
                second.status == "pending" and not await has_recorded_events(second)
            ))):
        confirmed_ids = {p["user_id"] for p in players}
        live_a = [uid for uid in loads_int_list(live.team_a_users) if uid in confirmed_ids]
        live_b = [uid for uid in loads_int_list(live.team_b_users) if uid in confirmed_ids]
        occupied = set(loads_int_list(live.team_a_users) + loads_int_list(live.team_b_users))
        available = [p for p in players if p["user_id"] not in occupied]
        if len(available) >= 2:
            # Retain the live sides as teams 1 and 2; draft the remaining
            # confirmed players into the other playing teams and one bench.
            free_count = body.team_count - 2
            free_playing = min(len(available), free_count * body.team_size)
            per_free_team, free_extra = divmod(free_playing, free_count)
            free_chunks: list[list[int]] = []
            offset = 0
            ordered_free = sorted(available, key=lambda p: float(p["skill"]), reverse=True)
            for i in range(free_count):
                count = per_free_team + (i < free_extra)
                free_chunks.append([p["user_id"] for p in ordered_free[offset:offset + count]])
                offset += count
            if offset < len(ordered_free):
                free_chunks.append([p["user_id"] for p in ordered_free[offset:]])
            free_teams = [
                [p["user_id"] for p in team]
                for team in rebalance_around_locked(
                    available, free_chunks, locked=set(), max_teams=free_count,
                    randomize=(mode == "random"), optimize=mode == "auto-balanced",
                    shuffle_equal=mode != "auto-balanced",
                )
            ]
            free_sides = free_teams[:2]
            partition = [live_a, live_b, *free_teams]
            reserved_names = {live.team_a_name, live.team_b_name}
            other_names = [
                name for name in generate_team_names(len(partition) + 2)
                if name not in reserved_names
            ]
            team_names = [live.team_a_name, live.team_b_name, *other_names[:len(partition) - 2]]
            meetup.manual_teams_json = json.dumps(partition)
            meetup.team_names_json = json.dumps(team_names)
            leftover = partition[body.team_count] if len(partition) > body.team_count else []

    if (first and opening_only and second is None and has_second_pitch
            and first.status in ("pending", "active", "time_up")):
        second_teams = free_sides if live else playing_teams[2:4]
        if len(second_teams) == 2 and all(second_teams):
            first.pitch = 1
            second = MeetupMatch(
                meetup_id=meetup_id, match_number=2, pitch=2,
                team_a_users=json.dumps(second_teams[0]),
                team_b_users=json.dumps(second_teams[1]),
                team_a_name=team_names[2], team_b_name=team_names[3],
                score_a=0, score_b=0, status="pending",
                timer_total_seconds=(meetup.match_duration_minutes or 10) * 60,
            )
            db.add(second)
            opening_matches.append(second)
            meetup.two_pitch = True

    if second and opening_only:
        first.pitch = 1
        second.pitch = 2
        meetup.two_pitch = True

    for m in matches:
        if m.status != "pending" or await has_recorded_events(m):
            continue
        if opening_only and second and (completed_opening or protected_second or not has_second_pitch):
            continue
        if opening_only and live:
            # The other opening pitch must never include a player already
            # playing. If there aren't two free sides, leave it unchanged.
            if m in opening_matches and len(free_sides) == 2 and all(free_sides):
                a, b = free_sides
                name_offset = 2 if m is second else 0
            else:
                continue
        elif m is second and opening_only and has_second_pitch:
            a, b = playing_teams[2:4]
            name_offset = 2
        elif m is second and opening_only:
            continue
        else:
            a = partition[0] if partition else []
            b = partition[1] if len(partition) > 1 else []
            name_offset = 0
        m.team_a_users = json.dumps(a)
        m.team_b_users = json.dumps(b)
        m.team_a_name = team_names[name_offset]
        m.team_b_name = team_names[name_offset + 1]

    if mode == "auto-balanced" and not started and not matches:
        # The shape is saved separately so later signups can be redrafted.
        meetup.manual_teams_json = None

    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    log_action(
        request,
        "teams",
        "teams.reshaped",
        f"Reshaped teams into {body.team_count}×{body.team_size} "
        f"({len(partition)} teams incl. bench, {len(leftover)} on bench)",
        meetup_id=meetup_id,
    )

    teams_nested = build_teams_from_manual(players, partition)
    out = format_teams_api_payload(teams_nested, team_names)
    return {
        "meetup_id": meetup_id,
        "content_revision": rev or 0,
        "teams": out,
    }


@router.patch("/{meetup_id}")
async def update_meetup(
    meetup_id: int,
    update_data: MeetupUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    data = update_data.model_dump(exclude_unset=True)

    # Cross-field check against the CURRENT values (the same rule create enforces).
    eff_min = data.get("min_players", meetup.min_players)
    eff_max = data.get("max_players", meetup.max_players)
    if eff_min is not None and eff_max is not None and eff_max < eff_min:
        raise HTTPException(
            status_code=400, detail="max_players must be >= min_players"
        )

    if "waitlist_mode" in data and data["waitlist_mode"]:
        m = data["waitlist_mode"].lower()
        if m not in ("broadcast", "auto_promote"):
            raise HTTPException(status_code=400, detail="Invalid waitlist_mode")
        data["waitlist_mode"] = m

    if not data:
        return {"status": "updated"}

    for key, value in data.items():
        setattr(meetup, key, value)

    if "team_assignment_mode" in data:
        meetup.manual_teams_json = None

    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    log_action(
        request,
        "meetup",
        "meetup.updated",
        f"Updated meetup — changed: {', '.join(sorted(data))}",
        meetup_id=meetup_id,
        meetup_start_time=meetup.start_time,
    )
    if "start_time" in data or "duration_minutes" in data:
        # Re-point the durable rating-reminder job at the new end time
        from app.services.rating_reminder_scheduler import register_rating_reminder

        await register_rating_reminder(db, meetup)
    return {"status": "updated"}


@router.post("/{meetup_id}/skip")
async def skip_meetup(
    meetup_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Hide a meetup from all listings and history (no trace). Undo: create a
    one-off meetup at the same date via the standard create form."""
    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")
    # Only today's or future meetups skip — past ones keep their history.
    day_start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    if meetup.start_time < day_start:
        raise HTTPException(
            status_code=400, detail="Only today's or future meetups can be skipped"
        )
    if not meetup.skipped:
        meetup.skipped = True
        if meetup.start_time <= utcnow():
            await db.flush()
            await refresh_player_skills(db)
        await db.commit()
        await notify_meetup_list_changed()
    # The overview must always have a next meetup: pull the upcoming
    # occurrence forward (normally created at end-of-meetup-day) so the admin
    # can manage signups right away. No push — invites go out on the
    # template's announce schedule. Idempotent per kickoff instant.
    if meetup.game_template_id:
        await materialize_next_meetup(meetup.game_template_id)
    log_action(
        request,
        "meetup",
        "meetup.skipped",
        "Skipped meetup; "
        "hidden from listings"
        + ("; next occurrence materialized" if meetup.game_template_id else ""),
        meetup_id=meetup_id,
        meetup_start_time=meetup.start_time,
    )
    return {"status": "skipped"}


def _meetup_started(meetup: Meetup) -> bool:
    """True once the meetup's start time has passed (stored naive-UTC)."""
    start = meetup.start_time
    if start.tzinfo is not None:  # defensive: normalize to naive UTC
        start = (start - (start.utcoffset() or timedelta(0))).replace(tzinfo=None)
    return utcnow() >= start


def _require_pre_start_or_admin(meetup: Meetup, request: Request) -> None:
    """Player attendance changes are pre-meetup; admins keep them at all times."""
    if _meetup_started(meetup) and not getattr(request.state, "is_admin", False):
        raise HTTPException(
            status_code=403,
            detail="Meetup already started — only admins can change attendance",
        )


class SignupHoldBody(BaseModel):
    token: str = Field(min_length=1, max_length=150)


@router.post("/signup-hold")
@limiter.limit(LIMIT_PUBLIC)
async def reserve_signup(
    request: Request, body: SignupHoldBody, db: AsyncSession = Depends(get_db),
):
    identities = read_signup_hold_token(body.token, utcnow())
    if identities is None:
        raise HTTPException(status_code=404, detail="This notification link is no longer valid.")

    meetup_id, user_id = identities
    await db.execute(text("BEGIN IMMEDIATE"))
    now = utcnow()
    meetup = await db.get(Meetup, meetup_id)
    if meetup is None or meetup.skipped or _meetup_started(meetup) or not await db.get(User, user_id):
        raise HTTPException(status_code=404, detail="This notification link is no longer valid.")
    signed_up = await db.scalar(select(Attendance.id).where(
        Attendance.meetup_id == meetup_id, Attendance.user_id == user_id,
        Attendance.status.in_(["confirmed", "waitlisted"]),
    ))
    if signed_up is None:
        hold = await open_signup_hold(db, meetup, user_id, now)
        if hold.settled or hold.expires_at <= now:
            return {"meetup_id": meetup_id, "hold_id": hold.id, "reserved": False}
        hold_id = hold.id
    else:
        hold_id = 0
    await db.commit()
    return {"meetup_id": meetup_id, "hold_id": hold_id, "reserved": True}


@router.post("/{meetup_id}/join")
async def join_meetup(
    meetup_id: int, request: Request, db: AsyncSession = Depends(get_db),
    reservation_id: int | None = Query(default=None, ge=0),
):
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = request.state.user.id
    await db.execute(text("BEGIN IMMEDIATE"))
    meetup = await db.get(Meetup, meetup_id)
    if not meetup or meetup.skipped:
        raise HTTPException(status_code=404, detail="Meetup not found")
    _require_pre_start_or_admin(meetup, request)

    attendance = await db.scalar(select(Attendance).where(
        Attendance.meetup_id == meetup_id, Attendance.user_id == user_id,
    ))
    if attendance and attendance.status != "cancelled":
        if reservation_id is not None:
            return {"status": attendance.status, "attendance_id": attendance.id}
        raise HTTPException(status_code=400, detail="Already joined meetup")

    attendance = await _signup_attendance(
        db, meetup, user_id, attendance, reservation_id=reservation_id,
    )
    if attendance.status == "confirmed":
        await refresh_after_confirmed_roster_change(db, meetup)
    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    await recalculate_skills_for_attendance_change(db, meetup_id, user_id)
    await db.refresh(attendance)
    log_action(
        request,
        "attendance",
        "attendance.joined",
        f"Joined as {attendance.status}",
        meetup_id=meetup_id,
        meetup_start_time=meetup.start_time,
    )
    return {"status": attendance.status, "attendance_id": attendance.id}


@router.delete("/{meetup_id}/leave")
async def leave_meetup(
    meetup_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = request.state.user.id

    result_attendance = await db.execute(
        select(Attendance).where(
            Attendance.meetup_id == meetup_id, Attendance.user_id == user_id
        )
    )
    attendance = result_attendance.scalar_one_or_none()
    if not attendance:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    if attendance.status == "cancelled":
        return {"status": "already_cancelled"}

    result_meetup = await db.execute(
        select(Meetup).where(Meetup.id == meetup_id)
    )
    meetup = result_meetup.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")
    _require_pre_start_or_admin(meetup, request)

    prev = attendance.status
    attendance.previous_status = prev
    attendance.status = "cancelled"
    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    await recalculate_skills_for_attendance_change(db, meetup_id, user_id)

    if prev == "confirmed":
        await handle_leave_or_cancel(db, meetup, prev)

    log_action(
        request,
        "attendance",
        "attendance.left",
        f"Cancelled attendance (was {prev})"
        + ("; a waitlisted player was promoted" if prev == "confirmed" else ""),
        meetup_id=meetup_id,
    )
    return {"status": "left"}


@router.post("/{meetup_id}/awards/weather-hero")
async def grant_weather_hero(
    meetup_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Award Weather Hero to every confirmed attendee (admin, one button).

    Idempotent per meetup: re-granting only reaches new confirmed attendees.
    """
    meetup = await db.get(Meetup, meetup_id)
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")
    already = set(
        (
            await db.execute(
                select(WeatherHeroAward.user_id).where(
                    WeatherHeroAward.granted_meetup_id == meetup_id
                )
            )
        )
        .scalars()
        .all()
    )
    confirmed = (
        (
            await db.execute(
                select(Attendance.user_id).where(
                    Attendance.meetup_id == meetup_id,
                    Attendance.status == "confirmed",
                )
            )
        )
        .scalars()
        .all()
    )
    granted = 0
    for uid in confirmed:
        if uid in already:
            continue
        db.add(WeatherHeroAward(user_id=uid, granted_meetup_id=meetup_id))
        granted += 1
    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    log_action(
        request,
        "attendance",
        "award.weather_hero_granted",
        f"Granted Weather Hero to {granted} confirmed attendee(s)"
        + (" (all already held one)" if granted == 0 else ""),
        meetup_id=meetup_id,
    )
    return {"granted": granted}


@router.post("/{meetup_id}/awards/weather-hero/redeem")
async def redeem_weather_hero(
    meetup_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Burn one unused Weather Hero award to upgrade from the waitlist to a
    confirmed spot. If the meetup is at capacity, the most-recently-joined
    confirmed player is demoted to the waitlist in exchange."""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    await db.execute(text("BEGIN IMMEDIATE"))
    meetup = await db.get(Meetup, meetup_id)
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    attendance = (
        (
            await db.execute(
                select(Attendance).where(
                    Attendance.meetup_id == meetup_id,
                    Attendance.user_id == user.id,
                )
            )
        )
        .scalar_one_or_none()
    )
    if not attendance or attendance.status != "waitlisted":
        raise HTTPException(
            status_code=409, detail="Only a waitlisted entry can redeem an award."
        )

    award = (
        (
            await db.execute(
                select(WeatherHeroAward)
                .where(
                    WeatherHeroAward.user_id == user.id,
                    WeatherHeroAward.used_at.is_(None),
                )
                .order_by(WeatherHeroAward.granted_at.asc(), WeatherHeroAward.id.asc())
            )
        )
        .scalars()
        .first()
    )
    if award is None:
        raise HTTPException(
            status_code=409, detail="You have no unused Weather Hero award."
        )

    now = utcnow()
    attendance.status = "confirmed"
    attendance.joined_at = now
    attendance.previous_status = None
    award.used_meetup_id = meetup_id
    award.used_at = now

    demoted: Attendance | None = None
    confirmed_others = (
        await db.execute(
            select(func.count(Attendance.id)).where(
                Attendance.meetup_id == meetup_id,
                Attendance.status == "confirmed",
                Attendance.user_id != user.id,
            )
        )
    ).scalar_one()
    held_spots = len(await active_hold_times(db, meetup_id, now))
    if confirmed_others + held_spots >= meetup.max_players:
        demoted = (
            (
                await db.execute(
                    select(Attendance)
                    .where(
                        Attendance.meetup_id == meetup_id,
                        Attendance.status == "confirmed",
                        Attendance.user_id != user.id,
                    )
                    .order_by(Attendance.joined_at.desc(), Attendance.id.desc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        if demoted is not None:
            demoted.status = "waitlisted"
            demoted.joined_at = now
            demoted.previous_status = "confirmed"
        elif held_spots:
            raise HTTPException(status_code=409, detail="A player is holding this spot while signing in.")

    await refresh_after_confirmed_roster_change(db, meetup)
    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    if demoted is not None:
        demoted_user = await db.get(User, demoted.user_id)
        if demoted_user is not None:
            await notify_demoted_to_waitlist(db, meetup, demoted_user)
        await recalculate_skills_for_attendance_change(db, meetup_id, demoted.user_id)
    await recalculate_skills_for_attendance_change(db, meetup_id, user.id)

    demoted_name = None
    if demoted is not None:
        demoted_user = await db.get(User, demoted.user_id)
        demoted_name = demoted_user.display_name if demoted_user else str(demoted.user_id)
    log_action(
        request,
        "attendance",
        "award.weather_hero_redeemed",
        f"Redeemed Weather Hero, upgraded to confirmed"
        + (f"; demoted {demoted_name} to waitlist" if demoted_name else ""),
        meetup_id=meetup_id,
    )
    return {
        "status": "confirmed",
        "demoted_user_id": demoted.user_id if demoted is not None else None,
    }


@router.post("/{meetup_id}/admin/attendance")
async def add_attendance(
    meetup_id: int,
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    await db.execute(text("BEGIN IMMEDIATE"))
    meetup = await db.get(Meetup, meetup_id)
    if not meetup or meetup.skipped:
        raise HTTPException(status_code=404, detail="Meetup not found")
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Player not found")

    existing = await db.scalar(select(Attendance.id).where(
        Attendance.meetup_id == meetup_id, Attendance.user_id == user_id,
    ))
    if existing is not None:
        raise HTTPException(
            status_code=409, detail="Player already has attendance for this meetup"
        )

    attendance = await _signup_attendance(db, meetup, user_id, None, respect_waitlist=False)
    if attendance.status == "confirmed":
        await refresh_after_confirmed_roster_change(db, meetup)
    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    await recalculate_skills_for_attendance_change(db, meetup_id, user_id)
    log_action(
        request,
        "attendance",
        "attendance.joined",
        f"Added {target.display_name} as {attendance.status}",
        meetup_id=meetup_id,
    )
    return {"status": attendance.status}


@router.delete("/{meetup_id}/admin/attendance/{user_id}")
async def remove_attendance_entry(
    meetup_id: int,
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    meetup = await db.get(Meetup, meetup_id)
    if not meetup or meetup.skipped:
        raise HTTPException(status_code=404, detail="Meetup not found")
    previous_status = await db.scalar(
        delete(Attendance)
        .where(Attendance.meetup_id == meetup_id, Attendance.user_id == user_id)
        .returning(Attendance.status)
    )
    if previous_status is None:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    # Re-adding the guest must not reactivate the old claim link.
    await db.execute(
        update(GuestPlusOne)
        .where(
            GuestPlusOne.meetup_id == meetup_id,
            GuestPlusOne.guest_user_id == user_id,
            GuestPlusOne.status == "pending",
        )
        .values(status="cancelled")
    )
    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    await handle_leave_or_cancel(db, meetup, previous_status)
    await update_user_calculated_skill(db, user_id)
    target = await db.get(User, user_id)
    log_action(
        request,
        "attendance",
        "attendance.deleted",
        f"Removed {target.display_name if target else f'user {user_id}'} from attendance",
        meetup_id=meetup_id,
        meetup_start_time=meetup.start_time,
    )
    return {"status": "deleted"}


@router.delete("/{meetup_id}/attendance/{user_id}")
async def delete_historical_attendance(
    meetup_id: int,
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    if not db.in_transaction():
        await db.execute(text("BEGIN IMMEDIATE"))
    meetup = await db.get(Meetup, meetup_id)
    if not meetup or meetup.skipped:
        raise HTTPException(status_code=404, detail="Meetup not found")
    if meetup.start_time >= utcnow():
        raise HTTPException(status_code=409, detail="Only past meetup attendance can be removed")
    attendance = await db.scalar(
        select(Attendance.id).where(
            Attendance.meetup_id == meetup_id, Attendance.user_id == user_id
        )
    )
    if attendance is None:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    target = await db.get(User, user_id)
    from app.services.deletes import delete_meetup_player_data

    await delete_meetup_player_data(db, meetup, user_id)
    await refresh_player_skills(db)
    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    log_action(
        request,
        "attendance",
        "attendance.deleted",
        f"Removed {target.display_name if target else f'user {user_id}'} from meetup history",
        meetup_id=meetup_id,
        meetup_start_time=meetup.start_time,
    )
    return {"status": "deleted"}


@router.post("/{meetup_id}/admin/move")
async def move_attendance(
    meetup_id: int,
    user_id: int,
    new_status: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    if new_status not in ["confirmed", "waitlisted", "cancelled"]:
        raise HTTPException(status_code=400, detail="Invalid status")

    await db.execute(text("BEGIN IMMEDIATE"))
    result_attendance = await db.execute(
        select(Attendance).where(
            Attendance.meetup_id == meetup_id, Attendance.user_id == user_id
        )
    )
    attendance = result_attendance.scalar_one_or_none()
    if not attendance:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    prev = attendance.status
    meetup = None
    if new_status == "confirmed" and prev != "confirmed":
        meetup = await db.get(Meetup, meetup_id)
        if meetup and not _meetup_started(meetup):
            now = utcnow()
            hold = await find_signup_hold(db, meetup_id, user_id)
            joined_at = now
            if hold and not hold.settled and hold.expires_at > now:
                joined_at = hold.started_at
                hold.settled = True
                await db.flush()
            holds = await active_hold_times(db, meetup_id, now)
            if holds and await signup_status(db, meetup, joined_at, now, respect_waitlist=False) != "confirmed":
                raise HTTPException(status_code=409, detail="A player is holding this spot while signing in.")
    attendance.status = new_status
    attendance.previous_status = prev if new_status == "cancelled" else None
    if new_status == "waitlisted" and prev != "waitlisted":
        # A player newly entering the waitlist goes to the back of the queue.
        attendance.joined_at = utcnow()
    if meetup:
        await refresh_after_confirmed_roster_change(db, meetup)
    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    await recalculate_skills_for_attendance_change(db, meetup_id, user_id)
    if prev == "confirmed" and new_status != "confirmed":
        # Moving or cancelling a confirmed entry opens the spot.
        meetup_res = await db.execute(
            select(Meetup).where(Meetup.id == meetup_id)
        )
        meetup = meetup_res.scalar_one_or_none()
        if meetup:
            await handle_leave_or_cancel(db, meetup, prev)
    target = await db.get(User, user_id)
    log_action(
        request,
        "attendance",
        "attendance.moved",
        f"Moved {target.display_name if target else f'user {user_id}'} from {prev} "
        f"to {new_status}",
        meetup_id=meetup_id,
    )
    return {"status": "moved"}


@router.post("/recurring/run-now")
async def run_recurring_meetups_now(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin: run the same logic as the weekly cron for every active template (create + notify if needed)."""
    result = await db.execute(
        select(GameTemplate).where(GameTemplate.is_active.is_(True))
    )
    templates = result.scalars().all()
    created = 0
    for tmpl in templates:
        if await materialize_next_meetup(tmpl.id):
            created += 1
        await notify_new_meetup(tmpl.id)
    log_action(
        request,
        "template",
        "template.run_now",
        f"Ran recurring materialization now: {created} meetup(s) created "
        f"from {len(templates)} active template(s)",
    )
    return {
        "status": "ok",
        "templates_checked": len(templates),
        "meetups_created": created,
    }


@router.delete("/{meetup_id}")
async def delete_meetup(
    meetup_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    meetup = await db.get(Meetup, meetup_id)
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")
    del_time = meetup.start_time

    await notify_meetup_cancelled_recipients(db, meetup)
    await notify_meetup_deleted(meetup_id)

    # Unqueue rating reminder job
    from app.services.rating_reminder_scheduler import unregister_rating_reminder

    await unregister_rating_reminder(db, meetup_id)

    from app.services.deletes import delete_meetup_children

    await delete_meetup_children(db, meetup_id)
    await db.delete(meetup)
    if meetup.start_time <= utcnow():
        await db.flush()
        await refresh_player_skills(db)
    await db.commit()
    await notify_meetup_list_changed()
    log_action(
        request,
        "meetup",
        "meetup.deleted",
        "Deleted meetup "
        "and all its matches, goals, ratings and chat",
        meetup_id=meetup_id,
        meetup_start_time=del_time,
    )
    return {"status": "deleted"}


def _meetup_events_stream(meetup_id: int | None, request: Request):
    async def event_generator():
        queue = await meetup_data_manager.subscribe(meetup_id)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {json.dumps(data)}\n\n"
                except TimeoutError:
                    yield ": ping\n\n"  # keep-alive, ignored by EventSource
        finally:
            await meetup_data_manager.unsubscribe(meetup_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx: don't buffer this stream
        },
    )


@router.get("/data/events")
@limiter.limit(LIMIT_SSE)
async def meetup_list_events(request: Request):
    """Notify open overviews when available meetups change."""
    return _meetup_events_stream(None, request)


@router.get("/{meetup_id}/data/events")
@limiter.limit(LIMIT_SSE)
async def meetup_data_events(meetup_id: int, request: Request):
    """SSE: roster/meetup field changes (`meetup_updated` / `meetup_deleted`)."""
    return _meetup_events_stream(meetup_id, request)


@router.get("/{meetup_id}/chat/events")
@limiter.limit(LIMIT_SSE)
async def chat_events(meetup_id: int, request: Request):
    async def event_generator():
        queue = await chat_manager.subscribe(meetup_id)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {json.dumps(data)}\n\n"
                except TimeoutError:
                    yield ": ping\n\n"  # keep-alive, ignored by EventSource
        finally:
            await chat_manager.unsubscribe(meetup_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx: don't buffer this stream
        },
    )


@router.get("/{meetup_id}/chat")
async def get_meetup_chat(
    meetup_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    """Chat history. Authenticated only — messages can contain personal plans."""
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.meetup_id == meetup_id)
        .options(selectinload(ChatMessage.user))
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()

    return [
        {
            "id": m.id,
            "user_id": m.user_id,
            "username": m.user.display_name if m.user else "Unknown",
            "message": m.message,
            "created_at": m.created_at,
            "avatar_url": m.user.avatar_url if m.user else None,
            "username_color": _name_color(m.user.display_name if m.user else "Unknown"),
        }
        for m in messages
    ]


@router.post("/{meetup_id}/chat/typing")
async def chat_typing_indicator(
    meetup_id: int,
    body: ChatTypingBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Broadcast typing state to other chat SSE subscribers (ephemeral, not stored)."""
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result_meetup = await db.execute(
        select(Meetup).where(Meetup.id == meetup_id)
    )
    if not result_meetup.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Meetup not found")

    u = request.state.user
    _display_name = u.display_name if hasattr(u, "display_name") else "Unknown"
    await chat_manager.broadcast(
        meetup_id,
        {
            "type": "typing",
            "user_id": u.id,
            "username": _display_name,
            "typing": body.typing,
        },
    )
    return {"status": "ok"}


@router.post("/{meetup_id}/chat/receipt")
async def update_chat_receipt(
    meetup_id: int,
    body: ChatReceiptUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Acknowledge messages received by this client and, if visible, read."""
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.read_id is not None and body.read_id > body.delivered_id:
        raise HTTPException(status_code=400, detail="Read message must be delivered")

    await db.execute(text("BEGIN IMMEDIATE"))
    message_ids = {body.delivered_id}
    if body.read_id is not None:
        message_ids.add(body.read_id)
    matching = set(await db.scalars(
        select(ChatMessage.id).where(
            ChatMessage.meetup_id == meetup_id, ChatMessage.id.in_(message_ids),
        )
    ))
    if matching != message_ids:
        raise HTTPException(status_code=404, detail="Chat message not found")

    insert = sqlite_insert(ChatReceipt).values(
        meetup_id=meetup_id,
        user_id=request.state.user.id,
        delivered_id=body.delivered_id,
        read_id=body.read_id or 0,
    )
    statement = insert.on_conflict_do_update(
        index_elements=[ChatReceipt.meetup_id, ChatReceipt.user_id],
        set_={
            "delivered_id": func.max(ChatReceipt.delivered_id, insert.excluded.delivered_id),
            "read_id": func.max(ChatReceipt.read_id, insert.excluded.read_id),
        },
        where=(ChatReceipt.delivered_id < insert.excluded.delivered_id)
        | (ChatReceipt.read_id < insert.excluded.read_id),
    ).returning(ChatReceipt.delivered_id, ChatReceipt.read_id)
    changed = (await db.execute(statement)).one_or_none()
    await db.commit()
    if changed is not None:
        await chat_manager.broadcast(meetup_id, {"type": "receipt"})
    return {"status": "ok"}


@router.get("/{meetup_id}/chat/receipts")
async def get_chat_receipts(
    meetup_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Return aggregate acknowledgements for the caller's messages."""
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = request.state.user.id
    messages = list(await db.scalars(
        select(ChatMessage.id).where(
            ChatMessage.meetup_id == meetup_id, ChatMessage.user_id == user_id,
        )
    ))
    receipts = list(await db.scalars(
        select(ChatReceipt).where(
            ChatReceipt.meetup_id == meetup_id, ChatReceipt.user_id != user_id,
        )
    ))
    return {
        str(message_id): {
            "delivered": sum(receipt.delivered_id >= message_id for receipt in receipts),
            "read": sum(receipt.read_id >= message_id for receipt in receipts),
        }
        for message_id in messages
    }


@router.post("/{meetup_id}/chat")
async def send_message(
    meetup_id: int,
    msg_data: ChatMessageCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result_meetup = await db.execute(
        select(Meetup).where(Meetup.id == meetup_id)
    )
    if not result_meetup.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Meetup not found")

    new_msg = ChatMessage(
        meetup_id=meetup_id, user_id=request.state.user.id, message=msg_data.message
    )
    db.add(new_msg)
    await db.flush()
    from app.services.job_queue import upsert_job

    await upsert_job(db, "chat_notification", new_msg.id, utcnow() + timedelta(seconds=3))
    await db.commit()
    await db.refresh(new_msg)

    _display_name = (
        request.state.user.display_name
        if hasattr(request.state.user, "display_name")
        else "Unknown"
    )

    broadcast_data = {
        "type": "message",
        "id": new_msg.id,
        "user_id": new_msg.user_id,
        "username": _display_name,
        "message": new_msg.message,
        "created_at": new_msg.created_at.isoformat(),
        "avatar_url": getattr(request.state.user, "avatar_url", None),
        "username_color": _name_color(_display_name),
    }
    await chat_manager.broadcast(meetup_id, broadcast_data)

    return {"status": "sent", "message_id": new_msg.id}


# ── Plus-one guest reservations ──────────────────────────────────


def _generate_claim_token() -> str:
    return secrets.token_urlsafe(24)  # ~32 chars


def _make_guest_pocket_id_sub() -> str:
    """Generate a synthetic pocket_id_sub for an unclaimed plus-one guest."""
    return f"guest.{secrets.token_hex(8)}"


@router.post("/{meetup_id}/plus-one", status_code=201)
@limiter.limit(LIMIT_MUTATION)
async def add_plus_one(
    meetup_id: int,
    body: PlusOneCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Add a plus-one guest to a meetup.

    Creates a placeholder User account and an Attendance row.
    Returns a claim link the guest can use to claim the account.
    """
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    inviter = request.state.user

    await db.execute(text("BEGIN IMMEDIATE"))
    # Verify meetup exists
    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    # Check inviter is confirmed for this meetup
    att_result = await db.execute(
        select(Attendance).where(
            Attendance.meetup_id == meetup_id,
            Attendance.user_id == inviter.id,
            Attendance.status == "confirmed",
        )
    )
    if not att_result.scalar_one_or_none():
        raise HTTPException(
            status_code=403,
            detail="You must be confirmed for this meetup to add a plus-one",
        )

    # Check if inviter already has a plus-one for this meetup
    existing = await db.execute(
        select(GuestPlusOne).where(
            GuestPlusOne.meetup_id == meetup_id,
            GuestPlusOne.inviter_id == inviter.id,
            GuestPlusOne.status == "pending",
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="You already have a plus-one for this meetup",
        )

    first_name = body.first_name.strip()
    last_name = body.last_name.strip()
    if not first_name or not last_name:
        raise HTTPException(status_code=400, detail="Names are required")

    # Create placeholder User with synthetic pocket_id_sub
    guest_sub = _make_guest_pocket_id_sub()
    guest_user = User(
        pocket_id_sub=guest_sub,
        sso_display_name=f"{first_name} {last_name}",
        seed_skill=float(body.skill),
        calculated_skill=float(body.skill),
    )
    db.add(guest_user)
    await db.flush()

    attendance = await _signup_attendance(db, meetup, guest_user.id, None)

    # Create GuestPlusOne record
    claim_token = _generate_claim_token()
    plus_one = GuestPlusOne(
        meetup_id=meetup_id,
        inviter_id=inviter.id,
        guest_user_id=guest_user.id,
        first_name=first_name,
        last_name=last_name,
        skill=body.skill,
        claim_token=claim_token,
        status="pending",
    )
    db.add(plus_one)
    await db.flush()

    if attendance.status == "confirmed":
        await refresh_after_confirmed_roster_change(db, meetup)
    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    log_action(
        request,
        "plus_one",
        "plus_one.added",
        f"Reserved a plus-one for {first_name} {last_name} "
        f"(guest {attendance.status})",
        meetup_id=meetup_id,
    )

    # Build claim URL (frontend handles the claim page)
    claim_url = f"/plus-one/{claim_token}"

    return {
        "id": plus_one.id,
        "guest_user_id": guest_user.id,
        "first_name": first_name,
        "last_name": last_name,
        "skill": body.skill,
        "claim_token": claim_token,
        "claim_url": claim_url,
        "attendance_status": attendance.status,
    }


@router.get("/{meetup_id}/plus-one")
async def list_plus_ones(
    meetup_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    """Pending plus-one reservations — the inviter sees their own, admins all.

    Claim tokens are capability links: the rest of the club doesn't need them.
    """
    user = request.state.user
    is_admin = getattr(request.state, "is_admin", False)
    stmt = (
        select(GuestPlusOne)
        .where(
            GuestPlusOne.meetup_id == meetup_id,
            GuestPlusOne.status == "pending",
        )
        .options(
            selectinload(GuestPlusOne.inviter),
            selectinload(GuestPlusOne.guest_user),
        )
    )
    if not is_admin:
        stmt = stmt.where(GuestPlusOne.inviter_id == user.id)
    result = await db.execute(stmt)
    plus_ones = result.scalars().all()
    return [
        {
            "id": po.id,
            "guest_user_id": po.guest_user_id,
            "first_name": po.first_name,
            "last_name": po.last_name,
            "skill": po.skill,
            "inviter_id": po.inviter_id,
            "inviter_display_name": po.inviter.display_name,
            "claim_token": po.claim_token,
            "status": po.status,
            "created_at": po.created_at.isoformat(),
        }
        for po in plus_ones
    ]


@router.delete("/{meetup_id}/plus-one/{plus_one_id}")
@limiter.limit(LIMIT_WRITE)
async def cancel_plus_one(
    meetup_id: int,
    plus_one_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Cancel a plus-one reservation (inviter only)."""
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(
        select(GuestPlusOne)
        .where(
            GuestPlusOne.id == plus_one_id,
            GuestPlusOne.meetup_id == meetup_id,
            GuestPlusOne.inviter_id == request.state.user.id,
            GuestPlusOne.status == "pending",
        )
        .options(selectinload(GuestPlusOne.guest_user))
    )
    plus_one = result.scalar_one_or_none()
    if not plus_one:
        raise HTTPException(status_code=404, detail="Plus-one not found")

    # Cancel the guest's attendance
    att_result = await db.execute(
        select(Attendance).where(
            Attendance.meetup_id == meetup_id,
            Attendance.user_id == plus_one.guest_user_id,
        )
    )
    attendance = att_result.scalar_one_or_none()
    if attendance:
        prev = attendance.status
        attendance.status = "cancelled"
        if prev == "confirmed":
            from app.services.meetup_promotion import handle_leave_or_cancel

            meetup_result = await db.execute(
                select(Meetup).where(Meetup.id == meetup_id)
            )
            meetup = meetup_result.scalar_one_or_none()
            if meetup:
                await handle_leave_or_cancel(db, meetup, prev)

    # Delete the placeholder user (children first: its attendance row from
    # above would block the FK now that SQLite enforces them).
    guest_user = plus_one.guest_user
    if guest_user:
        from app.services.deletes import delete_user_children

        await delete_user_children(db, guest_user.id)
        await db.delete(guest_user)

    # Delete the plus-one record
    await db.delete(plus_one)

    rev = await bump_meetup_revision(db, meetup_id)
    await db.commit()
    if rev is not None:
        await notify_meetup_data_changed(meetup_id, rev)
    log_action(
        request,
        "plus_one",
        "plus_one.cancelled",
        f"Cancelled plus-one for {plus_one.first_name} {plus_one.last_name}",
        meetup_id=meetup_id,
    )

    return {"status": "cancelled"}


@router.get("/plus-one/{claim_token}")
@limiter.limit(LIMIT_PUBLIC)
async def check_plus_one_claim(
    request: Request, claim_token: str, db: AsyncSession = Depends(get_db)
):
    """Public: check claim status for a plus-one token."""
    result = await db.execute(
        select(GuestPlusOne)
        .where(GuestPlusOne.claim_token == claim_token)
        .options(
            selectinload(GuestPlusOne.inviter),
            selectinload(GuestPlusOne.guest_user),
        )
    )
    plus_one = result.scalar_one_or_none()
    if not plus_one:
        raise HTTPException(status_code=404, detail="Invalid claim token")

    return {
        "id": plus_one.id,
        "status": plus_one.status,
        "first_name": plus_one.first_name,
        "last_name": plus_one.last_name,
        "skill": plus_one.skill,
        "meetup_id": plus_one.meetup_id,
        "inviter_display_name": plus_one.inviter.display_name,
        "guest_display_name": plus_one.guest_user.display_name,
    }


@router.post("/plus-one/{claim_token}/claim")
@limiter.limit(LIMIT_MUTATION)
async def claim_plus_one(
    claim_token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Claim a plus-one reservation.

    The guest must be authenticated via Pocket ID.
    The reserved attendance is transferred to the guest's existing member account.
    """
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(
        select(GuestPlusOne)
        .where(
            GuestPlusOne.claim_token == claim_token,
        )
        .options(
            selectinload(GuestPlusOne.guest_user),
            selectinload(GuestPlusOne.meetup),
        )
    )
    plus_one = result.scalar_one_or_none()
    if not plus_one:
        raise HTTPException(status_code=404, detail="Invalid claim token")

    from app.services.guest_claims import claim_reservation

    member = await db.get(User, request.state.user.id)
    if member is None:
        raise HTTPException(status_code=401, detail="Please sign in again")
    revision = await claim_reservation(db, plus_one, member)
    await db.commit()
    if revision is not None:
        await notify_meetup_data_changed(plus_one.meetup_id, revision)
    log_action(
        request,
        "plus_one",
        "plus_one.claimed",
        f"Claimed plus-one for {plus_one.first_name} {plus_one.last_name} "
        f"(reserved spot transferred to their account)",
        meetup_id=plus_one.meetup_id,
    )

    return {
        "status": "claimed",
        "user_id": member.id,
        "display_name": member.display_name,
        "calculated_skill": selected_rating(
            member, (await get_rating_settings(db)).computed_scores
        ),
    }


# ── Weather ─────────────────────────────────────────────────────


@router.get("/{meetup_id}/weather")
async def get_meetup_weather(meetup_id: int, db: AsyncSession = Depends(get_db)):
    """Get weather forecast for a meetup (cached 1 h) or recorded conditions.

    Returns:
    - ``recorded``: actual conditions captured at meetup end (if available)
    - ``forecast``: cached forecast for the meetup date (if available, < 1 h old)
    - ``can_refresh``: whether the client may request a fresh forecast
    """
    from datetime import timedelta

    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    response: dict = {}

    # Recorded actuals (always include if present)
    if meetup.weather_actual_temp_c is not None:
        response["recorded"] = {
            "temperature_c": meetup.weather_actual_temp_c,
            "weather_code": meetup.weather_actual_code,
            "label": meetup.weather_actual_label,
            "recorded_at": meetup.weather_actual_recorded_at.isoformat()
            if meetup.weather_actual_recorded_at
            else None,
        }

    # Cached forecast
    now = utcnow()
    fetched_at = meetup.weather_forecast_fetched_at
    if (
        fetched_at is not None
        and fetched_at > now - timedelta(hours=1)
        and meetup.weather_forecast_temp_c is not None
    ):
        response["forecast"] = {
            "temperature_c": meetup.weather_forecast_temp_c,
            "weather_code": meetup.weather_forecast_code,
            "label": meetup.weather_forecast_label,
            "cached_at": fetched_at.isoformat(),
        }
        response["can_refresh"] = False
    else:
        response["can_refresh"] = True

    return response


@router.post("/{meetup_id}/weather/refresh")
@limiter.limit(LIMIT_WRITE)
async def refresh_meetup_weather(
    meetup_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Fetch a fresh forecast from Open-Meteo and cache it for 1 hour.

    Authenticated only, and the 1 h cache is enforced server-side: a warm
    cache returns the stored values without any upstream call, so anonymous
    (or overzealous) clients cannot use this endpoint as a DoS proxy against
    the weather service.
    """
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")
    if meetup.latitude is None or meetup.longitude is None:
        raise HTTPException(status_code=400, detail="Meetup has no coordinates")

    # Serve warm cache — never forward the request upstream.
    fetched_at = meetup.weather_forecast_fetched_at
    if (
        fetched_at is not None
        and fetched_at > utcnow() - timedelta(hours=1)
        and meetup.weather_forecast_temp_c is not None
    ):
        return {
            "status": "cached",
            "temperature_c": meetup.weather_forecast_temp_c,
            "weather_code": meetup.weather_forecast_code,
            "label": meetup.weather_forecast_label,
            "cached_at": fetched_at.isoformat(),
        }

    # Naive start_time is UTC: tag it explicitly. .astimezone() would tag it
    # with the *server's* local tz, shifting the requested window on any
    # non-UTC box.
    start_time = to_utc(meetup.start_time)
    duration = meetup.duration_minutes or 120
    end_time = start_time + timedelta(minutes=duration)
    forecast = await weather_service.fetch_forecast(
        meetup.latitude, meetup.longitude, start_time, end_time
    )
    if forecast is None:
        # Forecast failed — fall back to current conditions.
        logger.info(
            "Weather forecast unavailable for %s, using current conditions",
            start_time.strftime("%Y-%m-%d %H:%M"),
        )
        current = await weather_service.fetch_current(
            meetup.latitude, meetup.longitude
        )
        if current is None:
            raise HTTPException(status_code=502, detail="Weather service unavailable")
        meetup.weather_forecast_temp_c = current["temp_c"]
        meetup.weather_forecast_code = current["weather_code"]
        meetup.weather_forecast_label = current["label"]
        meetup.weather_forecast_fetched_at = utcnow()
        await db.commit()
        return {
            "status": "ok",
            "temperature_c": current["temp_c"],
            "weather_code": current["weather_code"],
            "label": current["label"],
        }

    meetup.weather_forecast_temp_c = forecast["temp_c"]
    meetup.weather_forecast_code = forecast["weather_code"]
    meetup.weather_forecast_label = forecast["label"]
    meetup.weather_forecast_fetched_at = utcnow()

    await db.commit()

    return {
        "status": "ok",
        "temperature_c": forecast["temp_c"],
        "weather_code": forecast["weather_code"],
        "label": forecast["label"],
    }


@router.post("/{meetup_id}/weather/record")
async def record_meetup_weather(
    meetup_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Capture current conditions and save as the meetup's recorded weather.

    Admin-only. Typically called after the meetup ends.
    """
    result = await db.execute(select(Meetup).where(Meetup.id == meetup_id))
    meetup = result.scalar_one_or_none()
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")
    if meetup.latitude is None or meetup.longitude is None:
        raise HTTPException(status_code=400, detail="Meetup has no coordinates")

    current = await weather_service.fetch_current(meetup.latitude, meetup.longitude)
    if current is None:
        raise HTTPException(status_code=502, detail="Weather service unavailable")

    meetup.weather_actual_temp_c = current["temp_c"]
    meetup.weather_actual_code = current["weather_code"]
    meetup.weather_actual_label = current["label"]
    meetup.weather_actual_recorded_at = utcnow()

    await db.commit()

    return {
        "status": "ok",
        "temperature_c": current["temp_c"],
        "weather_code": current["weather_code"],
        "label": current["label"],
    }
