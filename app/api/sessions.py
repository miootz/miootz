from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi.responses import StreamingResponse
import json

from app.api.deps import require_admin
from app.core.database import get_db
from app.models.session import GameSession, Attendance
from app.models.session_recurrence import SessionRecurrenceRule
from app.models.user import User
from app.models.chat import ChatMessage
from app.core.chat_manager import chat_manager
from app.core.session_data_manager import session_data_manager
from app.services.session_promotion import handle_leave_or_cancel
from app.services.session_revision import (
    bump_session_revision,
    notify_session_data_changed,
    notify_session_deleted,
)
from app.services.manual_teams import (
    format_teams_api_payload,
    resolve_session_teams_nested,
    validate_team_partition,
    build_teams_from_manual,
)
from app.services.recurrence_scheduler import (
    register_recurrence_job,
    unregister_recurrence_job,
)
from app.services.notifications import notify_new_session_invites
from app.services.web_push import (
    notify_session_cancelled_recipients,
    notify_session_chat_recipients,
)
from app.services.recurring_sessions import (
    materialize_next_session_and_notify,
    utc_start_matches_rule,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])

TEAM_ASSIGNMENT_MODES = frozenset({"balanced", "random"})


def _normalize_team_mode(v: str) -> str:
    x = (v or "balanced").lower().strip()
    if x not in TEAM_ASSIGNMENT_MODES:
        raise ValueError("team_assignment_mode must be 'balanced' or 'random'")
    return x


class RecurrenceConfig(BaseModel):
    enabled: bool = False
    # Kickoff (meetup) each week — must match session start_time
    timezone: str = "UTC"
    weekday: int = Field(0, ge=0, le=6)
    hour: int = Field(0, ge=0, le=23)
    minute: int = Field(0, ge=0, le=59)
    # When each week to create the next session + send join-link emails
    announce_timezone: str = "UTC"
    announce_weekday: int = Field(0, ge=0, le=6)
    announce_hour: int = Field(9, ge=0, le=23)
    announce_minute: int = Field(0, ge=0, le=59)

    @field_validator("timezone", "announce_timezone")
    @classmethod
    def tz_ok(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except ZoneInfoNotFoundError as e:
            raise ValueError("Invalid IANA timezone") from e
        return v


class SessionCreate(BaseModel):
    start_time: datetime
    location: str
    fee: float = 0.0
    min_players: int = Field(default=10, ge=1, le=50)
    max_players: int = Field(default=15, ge=1, le=50)
    latitude: float | None = None
    longitude: float | None = None
    waitlist_mode: str = Field(default="auto_promote")
    team_assignment_mode: str = Field(default="balanced")
    recurrence: RecurrenceConfig | None = None
    #: When True (default), email all users with join links — same content as recurrence announcements.
    send_invite_emails: bool = True

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

    @model_validator(mode="after")
    def recurrence_aligns(self):
        if self.recurrence and self.recurrence.enabled:
            st = self.start_time
            if st.tzinfo is None:
                st = st.replace(tzinfo=timezone.utc)
            if not utc_start_matches_rule(
                st,
                self.recurrence.timezone,
                self.recurrence.weekday,
                self.recurrence.hour,
                self.recurrence.minute,
            ):
                raise ValueError(
                    "start_time must match recurrence weekday and time in the chosen timezone"
                )
        return self


class SessionUpdate(BaseModel):
    start_time: datetime | None = None
    location: str | None = None
    fee: float | None = None
    min_players: int | None = Field(default=None, ge=1, le=50)
    max_players: int | None = Field(default=None, ge=1, le=50)
    latitude: float | None = None
    longitude: float | None = None
    waitlist_mode: str | None = None
    team_assignment_mode: str | None = None
    recurrence: RecurrenceConfig | None = None

    @field_validator("team_assignment_mode")
    @classmethod
    def team_mode_update(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return _normalize_team_mode(v)


class TeamsUpdateBody(BaseModel):
    """Confirmed user ids grouped by team (same sizes as automatic snake draft)."""

    teams: list[list[str]]


class ChatMessageCreate(BaseModel):
    message: str


class ChatTypingBody(BaseModel):
    typing: bool = True


def _user_skill(u: User) -> float:
    """Single display skill for matchmaking: calculated first, then fallbacks."""
    if u.calculated_skill is not None:
        v = u.calculated_skill
    elif u.self_assessed_skill is not None:
        v = u.self_assessed_skill
    elif u.skill_level is not None:
        v = u.skill_level
    else:
        v = None
    return float(v) if v is not None else 50.0


def _recurrence_json(rule: SessionRecurrenceRule | None) -> dict | None:
    if not rule:
        return None
    return {
        "id": rule.id,
        "timezone": rule.timezone,
        "weekday": rule.weekday,
        "hour": rule.hour,
        "minute": rule.minute,
        "announce_timezone": rule.announce_timezone,
        "announce_weekday": rule.announce_weekday,
        "announce_hour": rule.announce_hour,
        "announce_minute": rule.announce_minute,
        "is_active": rule.is_active,
        "team_assignment_mode": getattr(rule, "team_assignment_mode", None)
        or "balanced",
    }


@router.post("/", status_code=201)
async def create_session(
    session_data: SessionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    payload = session_data.model_dump(exclude={"recurrence", "send_invite_emails"})
    rule: SessionRecurrenceRule | None = None
    if session_data.recurrence and session_data.recurrence.enabled:
        cfg = session_data.recurrence
        rule = SessionRecurrenceRule(
            timezone=cfg.timezone,
            weekday=cfg.weekday,
            hour=cfg.hour,
            minute=cfg.minute,
            announce_timezone=cfg.announce_timezone,
            announce_weekday=cfg.announce_weekday,
            announce_hour=cfg.announce_hour,
            announce_minute=cfg.announce_minute,
            location=payload["location"],
            fee=payload["fee"],
            min_players=payload["min_players"],
            max_players=payload["max_players"],
            latitude=payload.get("latitude"),
            longitude=payload.get("longitude"),
            waitlist_mode=payload["waitlist_mode"],
            team_assignment_mode=payload.get("team_assignment_mode", "balanced"),
            is_active=True,
        )
        db.add(rule)
        await db.flush()

    new_session = GameSession(
        **payload,
        recurrence_rule_id=rule.id if rule else None,
    )
    db.add(new_session)
    await db.flush()
    await db.commit()
    await db.refresh(new_session)
    rule_out = (
        await db.get(SessionRecurrenceRule, new_session.recurrence_rule_id)
        if new_session.recurrence_rule_id
        else None
    )
    if rule_out and rule_out.is_active:
        register_recurrence_job(rule_out)

    if session_data.send_invite_emails:
        result = await db.execute(select(User))
        recipients = [u for u in result.scalars().all() if u.email]
        if recipients:
            await notify_new_session_invites(new_session, recipients)

    return {
        "id": new_session.id,
        "start_time": new_session.start_time,
        "location": new_session.location,
        "fee": new_session.fee,
        "min_players": new_session.min_players,
        "max_players": new_session.max_players,
        "latitude": new_session.latitude,
        "longitude": new_session.longitude,
        "waitlist_mode": new_session.waitlist_mode,
        "team_assignment_mode": getattr(new_session, "team_assignment_mode", None)
        or "balanced",
        "content_revision": new_session.content_revision or 0,
        "recurrence_rule_id": new_session.recurrence_rule_id,
        "recurrence": _recurrence_json(rule_out),
    }


@router.get("/", response_model=list[dict])
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    limit: int | None = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, description="Filter by location (contains)"),
):
    stmt = select(GameSession).order_by(GameSession.start_time.asc())
    if q and (q := q.strip()):
        stmt = stmt.where(GameSession.location.ilike(f"%{q}%"))
    if limit is not None:
        stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    if not sessions:
        return []

    session_ids = [s.id for s in sessions]
    counts_result = await db.execute(
        select(Attendance.session_id, func.count(Attendance.id))
        .where(
            Attendance.session_id.in_(session_ids),
            Attendance.status == "confirmed",
        )
        .group_by(Attendance.session_id)
    )
    confirmed_by_session = {row[0]: row[1] for row in counts_result.all()}

    return [
        {
            "id": s.id,
            "start_time": s.start_time,
            "location": s.location,
            "fee": s.fee,
            "min_players": s.min_players,
            "max_players": s.max_players,
            "latitude": s.latitude,
            "longitude": s.longitude,
            "waitlist_mode": s.waitlist_mode,
            "team_assignment_mode": getattr(s, "team_assignment_mode", None)
            or "balanced",
            "content_revision": s.content_revision or 0,
            "recurrence_rule_id": s.recurrence_rule_id,
            "confirmed_count": confirmed_by_session.get(s.id, 0),
        }
        for s in sessions
    ]


@router.get("/{session_id}")
async def get_session(
    session_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(GameSession)
        .options(selectinload(GameSession.recurrence_rule))
        .where(GameSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(Attendance.session_id == session_id)
        .order_by(Attendance.joined_at.asc())
    )
    rows = result.all()

    attendees = []
    for att, user in rows:
        attendees.append(
            {
                "user_id": user.id,
                "username": user.username,
                "full_name": user.full_name,
                "profile_pic": user.profile_pic,
                "status": att.status,
                "joined_at": att.joined_at.isoformat() if att.joined_at else None,
                "skill": _user_skill(user),
                "self_assessed_skill": user.self_assessed_skill,
                "calculated_skill": user.calculated_skill,
            }
        )

    my_attendance = None
    user = getattr(request.state, "user", None)
    if user is not None:
        for att, u in rows:
            if u.id == user.id:
                my_attendance = att.status
                break

    return {
        "id": session.id,
        "start_time": session.start_time,
        "location": session.location,
        "fee": session.fee,
        "min_players": session.min_players,
        "max_players": session.max_players,
        "latitude": session.latitude,
        "longitude": session.longitude,
        "waitlist_mode": session.waitlist_mode,
        "team_assignment_mode": getattr(session, "team_assignment_mode", None)
        or "balanced",
        "content_revision": session.content_revision or 0,
        "recurrence_rule_id": session.recurrence_rule_id,
        "recurrence": _recurrence_json(session.recurrence_rule),
        "attendees": attendees,
        "my_attendance": my_attendance,
    }


@router.get("/{session_id}/teams")
async def get_session_teams(session_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GameSession).where(GameSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(
            Attendance.session_id == session_id,
            Attendance.status == "confirmed",
        )
    )
    rows = result.all()
    players = [
        {
            "id": str(user.id),
            "name": user.full_name or user.username,
            "skill": _user_skill(user),
            "user_id": user.id,
            "profile_pic": user.profile_pic,
        }
        for _, user in rows
    ]
    mode = getattr(session, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_session_teams_nested(
        getattr(session, "manual_teams_json", None),
        mode,
        players,
    )
    out = format_teams_api_payload(teams_nested)
    return {
        "session_id": session_id,
        "content_revision": session.content_revision or 0,
        "teams": out,
    }


@router.patch("/{session_id}/teams")
async def patch_session_teams(
    session_id: int,
    body: TeamsUpdateBody,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Persist admin team lineups (confirmed roster only)."""
    result = await db.execute(select(GameSession).where(GameSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(Attendance, User)
        .join(User, Attendance.user_id == User.id)
        .where(
            Attendance.session_id == session_id,
            Attendance.status == "confirmed",
        )
    )
    rows = result.all()
    players = [
        {
            "id": str(user.id),
            "name": user.full_name or user.username,
            "skill": _user_skill(user),
            "user_id": user.id,
            "profile_pic": user.profile_pic,
        }
        for _, user in rows
    ]
    confirmed_ids = {int(p["id"]) for p in players}
    try:
        int_teams = [[int(x) for x in team] for team in body.teams]
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid user id in teams")

    if not validate_team_partition(int_teams, confirmed_ids):
        raise HTTPException(
            status_code=400,
            detail="Teams must partition all confirmed players with valid team sizes",
        )

    session.manual_teams_json = json.dumps(int_teams)
    rev = await bump_session_revision(db, session_id)
    await db.commit()
    if rev is not None:
        await notify_session_data_changed(session_id, rev)

    teams_nested = build_teams_from_manual(players, int_teams)
    out = format_teams_api_payload(teams_nested)
    return {
        "session_id": session_id,
        "content_revision": rev or 0,
        "teams": out,
    }


@router.post("/{session_id}/teams/reshuffle")
async def reshuffle_session_teams(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Re-randomize teams (only when `team_assignment_mode` is `random`)."""
    result = await db.execute(select(GameSession).where(GameSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    mode = getattr(session, "team_assignment_mode", None) or "balanced"
    if mode != "random":
        raise HTTPException(
            status_code=400,
            detail="Reshuffle only applies when team_assignment_mode is random",
        )
    session.manual_teams_json = None
    rev = await bump_session_revision(db, session_id)
    await db.commit()
    if rev is not None:
        await notify_session_data_changed(session_id, rev)
    return {"status": "reshuffled", "content_revision": rev}


@router.patch("/{session_id}")
async def update_session(
    session_id: int,
    update_data: SessionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(GameSession).where(GameSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    data = update_data.model_dump(exclude_unset=True)
    rec_cfg = data.pop("recurrence", None)
    if "waitlist_mode" in data and data["waitlist_mode"]:
        m = data["waitlist_mode"].lower()
        if m not in ("broadcast", "auto_promote"):
            raise HTTPException(status_code=400, detail="Invalid waitlist_mode")
        data["waitlist_mode"] = m

    if not data and rec_cfg is None:
        return {"status": "updated"}

    for key, value in data.items():
        setattr(session, key, value)

    if "team_assignment_mode" in data:
        session.manual_teams_json = None

    if "team_assignment_mode" in data and session.recurrence_rule_id:
        rr_sync = await db.get(SessionRecurrenceRule, session.recurrence_rule_id)
        if rr_sync:
            rr_sync.team_assignment_mode = getattr(
                session, "team_assignment_mode", None
            ) or "balanced"

    if rec_cfg is not None:
        cfg = RecurrenceConfig.model_validate(rec_cfg)
        if not cfg.enabled:
            if session.recurrence_rule_id:
                rr = await db.get(SessionRecurrenceRule, session.recurrence_rule_id)
                if rr:
                    rr.is_active = False
                unregister_recurrence_job(session.recurrence_rule_id)
        else:
            st = session.start_time
            if st.tzinfo is None:
                st = st.replace(tzinfo=timezone.utc)
            if not utc_start_matches_rule(
                st,
                cfg.timezone,
                cfg.weekday,
                cfg.hour,
                cfg.minute,
            ):
                raise HTTPException(
                    status_code=400,
                    detail="start_time must match recurrence weekday and time in the chosen timezone",
                )
            if session.recurrence_rule_id:
                rr = await db.get(SessionRecurrenceRule, session.recurrence_rule_id)
                if rr:
                    rr.timezone = cfg.timezone
                    rr.weekday = cfg.weekday
                    rr.hour = cfg.hour
                    rr.minute = cfg.minute
                    rr.announce_timezone = cfg.announce_timezone
                    rr.announce_weekday = cfg.announce_weekday
                    rr.announce_hour = cfg.announce_hour
                    rr.announce_minute = cfg.announce_minute
                    rr.location = session.location
                    rr.fee = session.fee
                    rr.min_players = session.min_players
                    rr.max_players = session.max_players
                    rr.latitude = session.latitude
                    rr.longitude = session.longitude
                    rr.waitlist_mode = session.waitlist_mode
                    rr.team_assignment_mode = getattr(
                        session, "team_assignment_mode", None
                    ) or "balanced"
                    rr.is_active = True
                else:
                    session.recurrence_rule_id = None
            if not session.recurrence_rule_id:
                rr = SessionRecurrenceRule(
                    timezone=cfg.timezone,
                    weekday=cfg.weekday,
                    hour=cfg.hour,
                    minute=cfg.minute,
                    announce_timezone=cfg.announce_timezone,
                    announce_weekday=cfg.announce_weekday,
                    announce_hour=cfg.announce_hour,
                    announce_minute=cfg.announce_minute,
                    location=session.location,
                    fee=session.fee,
                    min_players=session.min_players,
                    max_players=session.max_players,
                    latitude=session.latitude,
                    longitude=session.longitude,
                    waitlist_mode=session.waitlist_mode,
                    team_assignment_mode=getattr(session, "team_assignment_mode", None)
                    or "balanced",
                    is_active=True,
                )
                db.add(rr)
                await db.flush()
                session.recurrence_rule_id = rr.id

    rev = await bump_session_revision(db, session_id)
    await db.commit()
    if rec_cfg is not None:
        cfg_after = RecurrenceConfig.model_validate(rec_cfg)
        if cfg_after.enabled and session.recurrence_rule_id:
            rr = await db.get(SessionRecurrenceRule, session.recurrence_rule_id)
            if rr and rr.is_active:
                register_recurrence_job(rr)
    if rev is not None:
        await notify_session_data_changed(session_id, rev)
    return {"status": "updated"}


@router.post("/{session_id}/join")
async def join_session(
    session_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = request.state.user.id

    result_session = await db.execute(
        select(GameSession).where(GameSession.id == session_id)
    )
    session = result_session.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result_attendance = await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id, Attendance.user_id == user_id
        )
    )
    attendance = result_attendance.scalar_one_or_none()

    if attendance:
        if attendance.status == "cancelled":
            attendance.previous_status = None
            attendance.joined_at = datetime.now(timezone.utc)
            result_confirmed = await db.execute(
                select(Attendance).where(
                    Attendance.session_id == session_id,
                    Attendance.status == "confirmed",
                )
            )
            confirmed_count = len(result_confirmed.scalars().all())
            attendance.status = (
                "confirmed" if confirmed_count < session.max_players else "waitlisted"
            )
            rev = await bump_session_revision(db, session_id)
            await db.commit()
            if rev is not None:
                await notify_session_data_changed(session_id, rev)
            await db.refresh(attendance)
            return {"status": attendance.status, "attendance_id": attendance.id}
        raise HTTPException(status_code=400, detail="Already joined session")

    result_confirmed = await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id, Attendance.status == "confirmed"
        )
    )
    confirmed_count = len(result_confirmed.scalars().all())

    status_new = "confirmed" if confirmed_count < session.max_players else "waitlisted"

    new_attendance = Attendance(
        session_id=session_id, user_id=user_id, status=status_new
    )
    db.add(new_attendance)
    rev = await bump_session_revision(db, session_id)
    await db.commit()
    if rev is not None:
        await notify_session_data_changed(session_id, rev)
    await db.refresh(new_attendance)

    return {"status": status_new, "attendance_id": new_attendance.id}


@router.delete("/{session_id}/leave")
async def leave_session(
    session_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = request.state.user.id

    result_attendance = await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id, Attendance.user_id == user_id
        )
    )
    attendance = result_attendance.scalar_one_or_none()
    if not attendance:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    if attendance.status == "cancelled":
        return {"status": "already_cancelled"}

    result_session = await db.execute(
        select(GameSession).where(GameSession.id == session_id)
    )
    session = result_session.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    prev = attendance.status
    attendance.previous_status = prev
    attendance.status = "cancelled"
    rev = await bump_session_revision(db, session_id)
    await db.commit()
    if rev is not None:
        await notify_session_data_changed(session_id, rev)

    if prev == "confirmed":
        await handle_leave_or_cancel(db, session, prev)

    return {"status": "left"}


@router.post("/{session_id}/admin/move")
async def move_attendance(
    session_id: int,
    user_id: int,
    new_status: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    if new_status not in ["confirmed", "waitlisted"]:
        raise HTTPException(status_code=400, detail="Invalid status")

    result_attendance = await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id, Attendance.user_id == user_id
        )
    )
    attendance = result_attendance.scalar_one_or_none()
    if not attendance:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    attendance.status = new_status
    attendance.previous_status = None
    rev = await bump_session_revision(db, session_id)
    await db.commit()
    if rev is not None:
        await notify_session_data_changed(session_id, rev)
    return {"status": "moved"}


@router.post("/recurring/run-now")
async def run_recurring_sessions_now(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin: run the same logic as the weekly cron for every active rule (create + notify if needed)."""
    result = await db.execute(
        select(SessionRecurrenceRule).where(SessionRecurrenceRule.is_active.is_(True))
    )
    rules = result.scalars().all()
    created = 0
    for rule in rules:
        if await materialize_next_session_and_notify(rule.id):
            created += 1
    return {"status": "ok", "rules_checked": len(rules), "sessions_created": created}


@router.delete("/{session_id}")
async def delete_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    session = await db.get(GameSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await notify_session_cancelled_recipients(db, session)
    await notify_session_deleted(session_id)
    await db.delete(session)
    await db.commit()
    return {"status": "deleted"}


@router.get("/{session_id}/data/events")
async def session_data_events(session_id: int, request: Request):
    """SSE: roster/session field changes (`session_updated` / `session_deleted`)."""

    async def event_generator():
        queue = await session_data_manager.subscribe(session_id)
        try:
            while True:
                if await request.is_disconnected():
                    break
                data = await queue.get()
                yield f"data: {json.dumps(data)}\n\n"
        finally:
            await session_data_manager.unsubscribe(session_id, queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/{session_id}/chat/events")
async def chat_events(session_id: int, request: Request):
    async def event_generator():
        queue = await chat_manager.subscribe(session_id)
        try:
            while True:
                if await request.is_disconnected():
                    break
                data = await queue.get()
                yield f"data: {json.dumps(data)}\n\n"
        finally:
            await chat_manager.unsubscribe(session_id, queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/{session_id}/chat")
async def get_session_chat(session_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .options(selectinload(ChatMessage.user))
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()
    def _username_color(username: str) -> str:
        """Deterministic pastel color from username for chat bubbles."""
        h = hash(username) & 0xFFFFFF
        r, g, b = (h >> 16) & 0xFF, (h >> 8) & 0xFF, h & 0xFF
        # Shift hue toward readable range, keep saturation moderate
        return f"#{(r ^ 0x40):02x}{(g ^ 0x30):02x}{(b ^ 0x50):02x}"

    return [
        {
            "id": m.id,
            "user_id": m.user_id,
            "username": m.user.username if m.user else "Unknown",
            "message": m.message,
            "created_at": m.created_at,
            "avatar_url": m.user.profile_pic if m.user else None,
            "username_color": _username_color(m.user.username if m.user else "Unknown"),
        }
        for m in messages
    ]


@router.post("/{session_id}/chat/typing")
async def chat_typing_indicator(
    session_id: int,
    body: ChatTypingBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Broadcast typing state to other chat SSE subscribers (ephemeral, not stored)."""
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result_session = await db.execute(
        select(GameSession).where(GameSession.id == session_id)
    )
    if not result_session.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

    u = request.state.user
    _username = u.username if hasattr(u, "username") else "Unknown"
    await chat_manager.broadcast(
        session_id,
        {
            "type": "typing",
            "user_id": u.id,
            "username": _username,
            "typing": body.typing,
        },
    )
    return {"status": "ok"}


@router.post("/{session_id}/chat")
async def send_message(
    session_id: int,
    msg_data: ChatMessageCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result_session = await db.execute(
        select(GameSession).where(GameSession.id == session_id)
    )
    if not result_session.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

    new_msg = ChatMessage(
        session_id=session_id, user_id=request.state.user.id, message=msg_data.message
    )
    db.add(new_msg)
    await db.commit()
    await db.refresh(new_msg)

    _username = (
        request.state.user.username
        if hasattr(request.state.user, "username")
        else "Unknown"
    )

    def _username_color(username: str) -> str:
        h = hash(username) & 0xFFFFFF
        r, g, b = (h >> 16) & 0xFF, (h >> 8) & 0xFF, h & 0xFF
        return f"#{(r ^ 0x40):02x}{(g ^ 0x30):02x}{(b ^ 0x50):02x}"

    broadcast_data = {
        "type": "message",
        "id": new_msg.id,
        "user_id": new_msg.user_id,
        "username": _username,
        "message": new_msg.message,
        "created_at": new_msg.created_at.isoformat(),
        "avatar_url": getattr(request.state.user, "profile_pic", None),
        "username_color": _username_color(_username),
    }
    await chat_manager.broadcast(session_id, broadcast_data)

    await notify_session_chat_recipients(
        db,
        session_id,
        request.state.user.id,
        _username,
        new_msg.message,
    )

    return {"status": "sent", "message_id": new_msg.id}
