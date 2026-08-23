from datetime import datetime, timedelta, timezone
import logging
import secrets

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi.responses import StreamingResponse
import json

from app.api.deps import require_admin
from app.core.database import get_db
from app.models.game_template import GameTemplate
from app.models.session import GameSession, Attendance, MatchScore
from app.models.match import SessionMatch
from app.models.user import User
from app.models.chat import ChatMessage
from app.models.guest_plus_one import GuestPlusOne
from app.models.rating import Rating
from app.core.chat_manager import chat_manager
from app.services.skill_service import (
    recalculate_skills_for_attendance_change,
    update_user_calculated_skill,
)
from app.core.session_data_manager import session_data_manager
from app.services.session_promotion import handle_leave_or_cancel
from app.services.session_revision import (
    bump_session_revision,
    notify_session_data_changed,
    notify_session_deleted,
)
from app.services.manual_teams import (
    ensure_team_names,
    format_teams_api_payload,
    get_team_names,
    resolve_session_teams_nested,
    validate_team_partition,
    build_teams_from_manual,
)
from app.services.team_adjustment import expand_teams, contract_teams
from app.services.web_push import (
    notify_new_session_invites,
    notify_session_cancelled_recipients,
    notify_session_chat_recipients,
)
from app.services.recurring_sessions import (
    materialize_next_session_and_notify,
    next_announce_occurrence_utc,
)
from app.services import weather_service

router = APIRouter(prefix="/sessions", tags=["sessions"])

TEAM_ASSIGNMENT_MODES = frozenset({"balanced", "random"})


def _normalize_team_mode(v: str) -> str:
    x = (v or "balanced").lower().strip()
    if x not in TEAM_ASSIGNMENT_MODES:
        raise ValueError("team_assignment_mode must be 'balanced' or 'random'")
    return x


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

    @field_validator("team_assignment_mode")
    @classmethod
    def team_mode_update(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return _normalize_team_mode(v)


class TeamsUpdateBody(BaseModel):
    """Confirmed user ids grouped by team (same sizes as automatic snake draft)."""

    teams: list[list[str]]


class TeamsAdjustBody(BaseModel):
    """Expand or contract teams, auto-promoting/returning waitlisted players."""

    operation: str  # "expand" | "contract"
    num_teams: int = 1


class ChatMessageCreate(BaseModel):
    message: str


class ChatTypingBody(BaseModel):
    typing: bool = True


class PlusOneCreate(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=80)
    last_name: str = Field(..., min_length=1, max_length=80)
    self_assessed_skill: int = Field(..., ge=1, le=5)


class PlusOneClaim(BaseModel):
    """Claim a plus-one guest reservation.
    
    The guest must already have a Pocket ID account.
    Their pocket_id_sub is extracted from the auth middleware.
    """


def _user_skill(u: User) -> float:
    """Single display skill for matchmaking: calculated first, then fallbacks."""
    if u.calculated_skill is not None:
        v = u.calculated_skill
    elif u.self_assessed_skill is not None:
        v = u.self_assessed_skill
    else:
        v = None
    return float(v) if v is not None else 50.0


def _game_template_json(t: GameTemplate | None) -> dict | None:
    if not t:
        return None
    next_announce = (
        next_announce_occurrence_utc(t, datetime.now(timezone.utc))
        if t.is_active
        else None
    )
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
        "team_assignment_mode": getattr(t, "team_assignment_mode", None)
        or "balanced",
        "next_announce_at": next_announce.isoformat() if next_announce else None,
    }


@router.post("/", status_code=201)
async def create_session(
    session_data: SessionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    payload = session_data.model_dump(exclude={"send_push_notifications"})
    new_session = GameSession(**payload, game_template_id=None)
    # Auto-generate team names (default 3 teams for max_players=15)
    ensure_team_names(new_session, 3)
    db.add(new_session)
    await db.flush()
    await db.commit()
    await db.refresh(new_session)

    if session_data.send_push_notifications:
        result = await db.execute(select(User))
        all_users = result.scalars().all()
        if all_users:
            await notify_new_session_invites(db, new_session, list(all_users))

    # Schedule rating reminder at session end time
    from app.services.rating_reminder_scheduler import register_rating_reminder

    register_rating_reminder(new_session)

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
        "game_template_id": new_session.game_template_id,
        "game_template": None,
    }


@router.get("/")
async def list_sessions(
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
    now = datetime.now(timezone.utc)
    filters = []
    if q and (q := q.strip()):
        filters.append(GameSession.location.ilike(f"%{q}%"))
    if status == "past":
        filters.append(GameSession.start_time < now)
    elif status == "upcoming":
        filters.append(GameSession.start_time >= now)
    elif status not in (None, "all"):
        raise HTTPException(status_code=400, detail="Invalid status filter")
    o = order.lower()
    if o not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="Invalid order")

    count_stmt = select(func.count()).select_from(GameSession)
    for f in filters:
        count_stmt = count_stmt.where(f)
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = select(GameSession).options(selectinload(GameSession.game_template))
    for f in filters:
        stmt = stmt.where(f)
    if o == "asc":
        stmt = stmt.order_by(GameSession.start_time.asc())
    else:
        stmt = stmt.order_by(GameSession.start_time.desc())
    stmt = stmt.offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    if not sessions:
        return {
            "items": [],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

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

    items = [
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
            "game_template_id": s.game_template_id,
            "game_template": _game_template_json(s.game_template),
            "confirmed_count": confirmed_by_session.get(s.id, 0),
        }
        for s in sessions
    ]
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{session_id}")
async def get_session(
    session_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(GameSession)
        .options(selectinload(GameSession.game_template))
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

    # Resolve which attendees are plus-one guests
    plus_one_user_ids: set[int] = set()
    if rows:
        user_ids = [u.id for _, u in rows]
        po_result = await db.execute(
            select(GuestPlusOne.guest_user_id).where(
                GuestPlusOne.session_id == session_id,
                GuestPlusOne.guest_user_id.in_(user_ids),
            )
        )
        plus_one_user_ids = {row[0] for row in po_result.all()}

    attendees = []
    for att, user in rows:
        attendees.append(
            {
                "user_id": user.id,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
                "status": att.status,
                "joined_at": att.joined_at.isoformat() if att.joined_at else None,
                "skill": _user_skill(user),
                "self_assessed_skill": user.self_assessed_skill,
                "calculated_skill": user.calculated_skill,
                "is_plus_one": user.id in plus_one_user_ids,
                "primary_specialty": user.primary_specialty,
                "secondary_specialty": user.secondary_specialty,
            }
        )

    my_attendance = None
    my_waitlist_position = None
    user = getattr(request.state, "user", None)
    if user is not None:
        for att, u in rows:
            if u.id == user.id:
                my_attendance = att.status
                break
        if my_attendance == "waitlisted":
            waitlist = [
                u.id
                for att, u in rows
                if att.status == "waitlisted"
            ]
            if user.id in waitlist:
                my_waitlist_position = waitlist.index(user.id) + 1

    # Current active/pending match
    current_match = None
    result = await db.execute(
        select(SessionMatch)
        .where(SessionMatch.session_id == session_id)
        .where(SessionMatch.status.in_(["active", "time_up", "pending"]))
        .order_by(SessionMatch.match_number.desc())
        .limit(1)
    )
    active_match = result.scalar_one_or_none()
    if active_match:
        import json as _json
        team_a_users = _json.loads(active_match.team_a_users)
        team_b_users = _json.loads(active_match.team_b_users)
        user_map = {r[1].id: r[1] for _, r in []}
        # Build from existing attendee data
        attendee_map = {a["user_id"]: a for a in attendees}

        def _user_list(ids):
            out = []
            for uid in ids:
                a = attendee_map.get(uid)
                if a:
                    out.append({"id": uid, "display_name": a["display_name"], "avatar_url": a["avatar_url"]})
                else:
                    out.append({"id": uid, "display_name": f"User {uid}", "avatar_url": None})
            return out

        current_match = {
            "id": active_match.id,
            "match_number": active_match.match_number,
            "team_a": {"name": active_match.team_a_name, "users": _user_list(team_a_users)},
            "team_b": {"name": active_match.team_b_name, "users": _user_list(team_b_users)},
            "score_a": active_match.score_a,
            "score_b": active_match.score_b,
            "status": active_match.status,
            "timer_total_seconds": active_match.timer_total_seconds,
            "timer_seconds_remaining": active_match.timer_seconds_remaining,
            "timer_paused": active_match.timer_pause_intervals is not None,
        }

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
        "game_template_id": session.game_template_id,
        "game_template": _game_template_json(session.game_template),
        "duration_minutes": session.duration_minutes,
        "max_teams": session.max_teams,
        "attendees": attendees,
        "my_attendance": my_attendance,
        "my_waitlist_position": my_waitlist_position,
        "current_match": current_match,
    }


@router.get("/{session_id}/history-summary")
async def get_session_history_summary(
    session_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    """Lightweight per-session summary for the History list: match count, final
    result, and the viewer's average rating. One request instead of N+1."""
    user = getattr(request.state, "user", None)
    result = await db.execute(
        select(SessionMatch)
        .where(SessionMatch.session_id == session_id)
        .where(SessionMatch.status == "completed")
        .order_by(SessionMatch.completed_at.asc(), SessionMatch.match_number.asc())
    )
    matches = result.scalars().all()
    final = None
    if matches:
        last = matches[-1]
        final = {
            "team_a_name": last.team_a_name,
            "score_a": last.score_a,
            "team_b_name": last.team_b_name,
            "score_b": last.score_b,
        }
    my_rating_avg = None
    if user is not None:
        r = await db.execute(
            select(Rating.score)
            .where(Rating.session_id == session_id)
            .where(Rating.rater_id == user.id)
        )
        scores = [row[0] for row in r.all() if row[0] and row[0] > 0]
        if scores:
            my_rating_avg = sum(scores) / len(scores)
    return {
        "match_count": len(matches),
        "final": final,
        "my_rating_avg": my_rating_avg,
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
            "name": user.display_name,
            "skill": _user_skill(user),
            "user_id": user.id,
            "avatar_url": user.avatar_url,
            "primary_specialty": user.primary_specialty,
            "secondary_specialty": user.secondary_specialty,
            "calculated_skill": user.calculated_skill,
        }
        for _, user in rows
    ]
    mode = getattr(session, "team_assignment_mode", None) or "balanced"
    teams_nested = resolve_session_teams_nested(
        getattr(session, "manual_teams_json", None),
        mode,
        players,
        max_teams=getattr(session, "max_teams", None),
    )
    team_names = get_team_names(session)
    out = format_teams_api_payload(teams_nested, team_names)
    return {
        "session_id": session_id,
        "content_revision": session.content_revision or 0,
        "teams": out,
    }


@router.get("/{session_id}/scores")
async def get_session_scores(session_id: int, db: AsyncSession = Depends(get_db)):
    """Get all match scores for a session."""
    result = await db.execute(
        select(MatchScore, User)
        .join(User, MatchScore.player_id == User.id)
        .where(MatchScore.session_id == session_id)
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
            "name": user.display_name,
            "skill": _user_skill(user),
            "user_id": user.id,
            "avatar_url": user.avatar_url,
        }
        for _, user in rows
    ]
    confirmed_ids = {int(p["id"]) for p in players}
    try:
        int_teams = [[int(x) for x in team] for team in body.teams]
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid user id in teams")

    if not validate_team_partition(int_teams, confirmed_ids, max_teams=session.max_teams):
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


@router.post("/{session_id}/teams/adjust")
async def adjust_session_teams(
    session_id: int,
    body: TeamsAdjustBody,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Expand or contract teams, auto-promoting/returning waitlisted players.

    - **expand**: adds *num_teams* teams and promotes waitlisted players (FIFO by joined_at).
    - **contract**: removes *num_teams* teams and returns excess confirmed players to waitlist (LIFO).
    """
    result = await db.execute(select(GameSession).where(GameSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    op = body.operation.lower().strip()
    if op not in ("expand", "contract"):
        raise HTTPException(status_code=400, detail="operation must be 'expand' or 'contract'")
    if body.num_teams < 1:
        raise HTTPException(status_code=400, detail="num_teams must be >= 1")

    if op == "expand":
        outcome = await expand_teams(db, session, body.num_teams)
    else:
        outcome = await contract_teams(db, session, body.num_teams)

    if "error" in outcome:
        raise HTTPException(status_code=400, detail=outcome["error"])

    return outcome


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
    if "waitlist_mode" in data and data["waitlist_mode"]:
        m = data["waitlist_mode"].lower()
        if m not in ("broadcast", "auto_promote"):
            raise HTTPException(status_code=400, detail="Invalid waitlist_mode")
        data["waitlist_mode"] = m

    if not data:
        return {"status": "updated"}

    for key, value in data.items():
        setattr(session, key, value)

    if "team_assignment_mode" in data:
        session.manual_teams_json = None

    rev = await bump_session_revision(db, session_id)
    await db.commit()
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
            await recalculate_skills_for_attendance_change(db, session_id, user_id)
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
    await recalculate_skills_for_attendance_change(db, session_id, user_id)
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
    await recalculate_skills_for_attendance_change(db, session_id, user_id)

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
    await recalculate_skills_for_attendance_change(db, session_id, user_id)
    return {"status": "moved"}


@router.post("/recurring/run-now")
async def run_recurring_sessions_now(
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
        if await materialize_next_session_and_notify(tmpl.id):
            created += 1
    return {
        "status": "ok",
        "templates_checked": len(templates),
        "sessions_created": created,
    }


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

    # Unschedule rating reminder job
    from app.services.rating_reminder_scheduler import unregister_rating_reminder

    unregister_rating_reminder(session_id)

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
    def _name_color(name: str) -> str:
        """Deterministic pastel color from display name for chat bubbles."""
        h = hash(name) & 0xFFFFFF
        r, g, b = (h >> 16) & 0xFF, (h >> 8) & 0xFF, h & 0xFF
        return f"#{(r ^ 0x40):02x}{(g ^ 0x30):02x}{(b ^ 0x50):02x}"

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
    _display_name = u.display_name if hasattr(u, "display_name") else "Unknown"
    await chat_manager.broadcast(
        session_id,
        {
            "type": "typing",
            "user_id": u.id,
            "username": _display_name,
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

    _display_name = (
        request.state.user.display_name
        if hasattr(request.state.user, "display_name")
        else "Unknown"
    )

    def _name_color(name: str) -> str:
        h = hash(name) & 0xFFFFFF
        r, g, b = (h >> 16) & 0xFF, (h >> 8) & 0xFF, h & 0xFF
        return f"#{(r ^ 0x40):02x}{(g ^ 0x30):02x}{(b ^ 0x50):02x}"

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
    await chat_manager.broadcast(session_id, broadcast_data)

    await notify_session_chat_recipients(
        db,
        session_id,
        request.state.user.id,
        _display_name,
        new_msg.message,
    )

    return {"status": "sent", "message_id": new_msg.id}


# ── Plus-one guest reservations ──────────────────────────────────

def _generate_claim_token() -> str:
    return secrets.token_urlsafe(24)  # ~32 chars


def _make_guest_pocket_id_sub() -> str:
    """Generate a synthetic pocket_id_sub for an unclaimed plus-one guest."""
    return f"guest.{secrets.token_hex(8)}"


@router.post("/{session_id}/plus-one", status_code=201)
async def add_plus_one(
    session_id: int,
    body: PlusOneCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Add a plus-one guest to a session.

    Creates a placeholder User account and an Attendance row.
    Returns a claim link the guest can use to claim the account.
    """
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    inviter = request.state.user

    # Verify session exists
    result = await db.execute(
        select(GameSession).where(GameSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Check inviter is confirmed for this session
    att_result = await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.user_id == inviter.id,
            Attendance.status == "confirmed",
        )
    )
    if not att_result.scalar_one_or_none():
        raise HTTPException(
            status_code=403,
            detail="You must be confirmed for this session to add a plus-one",
        )

    # Check if inviter already has a plus-one for this session
    existing = await db.execute(
        select(GuestPlusOne).where(
            GuestPlusOne.session_id == session_id,
            GuestPlusOne.inviter_id == inviter.id,
            GuestPlusOne.status == "pending",
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="You already have a plus-one for this session",
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
        self_assessed_skill=body.self_assessed_skill,
    )
    db.add(guest_user)
    await db.flush()

    # Create Attendance for the guest
    confirmed_result = await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.status == "confirmed",
        )
    )
    confirmed_count = len(confirmed_result.scalars().all())
    att_status = "confirmed" if confirmed_count < session.max_players else "waitlisted"

    attendance = Attendance(
        session_id=session_id,
        user_id=guest_user.id,
        status=att_status,
    )
    db.add(attendance)

    # Create GuestPlusOne record
    claim_token = _generate_claim_token()
    plus_one = GuestPlusOne(
        session_id=session_id,
        inviter_id=inviter.id,
        guest_user_id=guest_user.id,
        first_name=first_name,
        last_name=last_name,
        self_assessed_skill=body.self_assessed_skill,
        claim_token=claim_token,
        status="pending",
    )
    db.add(plus_one)
    await db.flush()

    rev = await bump_session_revision(db, session_id)
    await db.commit()
    if rev is not None:
        await notify_session_data_changed(session_id, rev)

    # Build claim URL (frontend handles the claim page)
    claim_url = f"/plus-one/{claim_token}"

    return {
        "id": plus_one.id,
        "guest_user_id": guest_user.id,
        "first_name": first_name,
        "last_name": last_name,
        "self_assessed_skill": body.self_assessed_skill,
        "claim_token": claim_token,
        "claim_url": claim_url,
        "attendance_status": att_status,
    }


@router.get("/{session_id}/plus-one")
async def list_plus_ones(session_id: int, db: AsyncSession = Depends(get_db)):
    """List pending plus-one reservations for a session."""
    result = await db.execute(
        select(GuestPlusOne)
        .where(
            GuestPlusOne.session_id == session_id,
            GuestPlusOne.status == "pending",
        )
        .options(
            selectinload(GuestPlusOne.inviter),
            selectinload(GuestPlusOne.guest_user),
        )
    )
    plus_ones = result.scalars().all()
    return [
        {
            "id": po.id,
            "guest_user_id": po.guest_user_id,
            "first_name": po.first_name,
            "last_name": po.last_name,
            "self_assessed_skill": po.self_assessed_skill,
            "inviter_id": po.inviter_id,
            "inviter_display_name": po.inviter.display_name,
            "claim_token": po.claim_token,
            "status": po.status,
            "created_at": po.created_at.isoformat(),
        }
        for po in plus_ones
    ]


@router.delete("/{session_id}/plus-one/{plus_one_id}")
async def cancel_plus_one(
    session_id: int,
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
            GuestPlusOne.session_id == session_id,
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
            Attendance.session_id == session_id,
            Attendance.user_id == plus_one.guest_user_id,
        )
    )
    attendance = att_result.scalar_one_or_none()
    if attendance:
        prev = attendance.status
        attendance.status = "cancelled"
        if prev == "confirmed":
            from app.services.session_promotion import handle_leave_or_cancel

            session_result = await db.execute(
                select(GameSession).where(GameSession.id == session_id)
            )
            session = session_result.scalar_one_or_none()
            if session:
                await handle_leave_or_cancel(db, session, prev)

    # Delete the placeholder user
    guest_user = plus_one.guest_user
    if guest_user:
        await db.delete(guest_user)

    # Delete the plus-one record
    await db.delete(plus_one)

    rev = await bump_session_revision(db, session_id)
    await db.commit()
    if rev is not None:
        await notify_session_data_changed(session_id, rev)

    return {"status": "cancelled"}


@router.get("/plus-one/{claim_token}")
async def check_plus_one_claim(claim_token: str, db: AsyncSession = Depends(get_db)):
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
        "self_assessed_skill": plus_one.self_assessed_skill,
        "session_id": plus_one.session_id,
        "inviter_display_name": plus_one.inviter.display_name,
        "guest_display_name": plus_one.guest_user.display_name,
    }


@router.post("/plus-one/{claim_token}/claim")
async def claim_plus_one(
    claim_token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Claim a plus-one reservation.

    The guest must be authenticated via Pocket ID.
    The placeholder user is linked to the guest's Pocket ID account.
    """
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(
        select(GuestPlusOne)
        .where(
            GuestPlusOne.claim_token == claim_token,
            GuestPlusOne.status == "pending",
        )
        .options(
            selectinload(GuestPlusOne.guest_user),
            selectinload(GuestPlusOne.session),
        )
    )
    plus_one = result.scalar_one_or_none()
    if not plus_one:
        raise HTTPException(status_code=404, detail="Invalid or already claimed token")

    # Update the placeholder user with the guest's Pocket ID identity
    guest_user = plus_one.guest_user
    if not guest_user:
        raise HTTPException(status_code=400, detail="Guest account not found")

    guest_user.pocket_id_sub = request.state.user.pocket_id_sub
    guest_user.sso_display_name = request.state.user.sso_display_name
    guest_user.sso_groups = request.state.user.sso_groups
    # Preserve the self-assessed skill set by the inviter
    guest_user.self_assessed_skill = plus_one.self_assessed_skill

    # Mark as claimed
    plus_one.status = "claimed"
    plus_one.claimed_by_user_id = guest_user.id
    plus_one.claimed_at = datetime.utcnow()

    await db.commit()
    await db.refresh(guest_user)

    return {
        "status": "claimed",
        "user_id": guest_user.id,
        "display_name": guest_user.display_name,
        "self_assessed_skill": guest_user.self_assessed_skill,
    }


# ── Weather ─────────────────────────────────────────────────────

@router.get("/{session_id}/weather")
async def get_session_weather(session_id: int, db: AsyncSession = Depends(get_db)):
    """Get weather forecast for a session (cached 1 h) or recorded conditions.

    Returns:
    - ``recorded``: actual conditions captured at session end (if available)
    - ``forecast``: cached forecast for the session date (if available, < 1 h old)
    - ``can_refresh``: whether the client may request a fresh forecast
    """
    from datetime import timedelta

    result = await db.execute(select(GameSession).where(GameSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    response: dict = {}

    # Recorded actuals (always include if present)
    if session.weather_actual_temp_c is not None:
        response["recorded"] = {
            "temperature_c": session.weather_actual_temp_c,
            "weather_code": session.weather_actual_code,
            "label": session.weather_actual_label,
            "recorded_at": session.weather_actual_recorded_at.isoformat()
            if session.weather_actual_recorded_at
            else None,
        }

    # Cached forecast
    now = datetime.utcnow()
    forecast_age_ok = (
        session.weather_forecast_fetched_at
        and session.weather_forecast_fetched_at > now - timedelta(hours=1)
    )
    if forecast_age_ok and session.weather_forecast_temp_c is not None:
        response["forecast"] = {
            "temperature_c": session.weather_forecast_temp_c,
            "weather_code": session.weather_forecast_code,
            "label": session.weather_forecast_label,
            "cached_at": session.weather_forecast_fetched_at.isoformat(),
        }
        response["can_refresh"] = False
    else:
        response["can_refresh"] = True

    return response


@router.post("/{session_id}/weather/refresh")
async def refresh_session_weather(session_id: int, db: AsyncSession = Depends(get_db)):
    """Fetch a fresh forecast from Open-Meteo and cache it for 1 hour."""
    result = await db.execute(select(GameSession).where(GameSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.latitude is None or session.longitude is None:
        raise HTTPException(status_code=400, detail="Session has no coordinates")

    start_time = session.start_time.astimezone()
    duration = session.duration_minutes or 120
    end_time = start_time + timedelta(minutes=duration)
    forecast = await weather_service.fetch_forecast(
        session.latitude, session.longitude, start_time, end_time
    )
    if forecast is None:
        # Forecast failed — fall back to current conditions.
        logger.info(
            "Weather forecast unavailable for %s, using current conditions",
            start_time.strftime("%Y-%m-%d %H:%M"),
        )
        current = await weather_service.fetch_current(
            session.latitude, session.longitude
        )
        if current is None:
            raise HTTPException(status_code=502, detail="Weather service unavailable")
        session.weather_forecast_temp_c = current["temp_c"]
        session.weather_forecast_code = current["weather_code"]
        session.weather_forecast_label = current["label"]
        session.weather_forecast_fetched_at = datetime.utcnow()
        await db.commit()
        return {
            "status": "ok",
            "temperature_c": current["temp_c"],
            "weather_code": current["weather_code"],
            "label": current["label"],
        }

    session.weather_forecast_temp_c = forecast["temp_c"]
    session.weather_forecast_code = forecast["weather_code"]
    session.weather_forecast_label = forecast["label"]
    session.weather_forecast_fetched_at = datetime.utcnow()

    await db.commit()

    return {
        "status": "ok",
        "temperature_c": forecast["temp_c"],
        "weather_code": forecast["weather_code"],
        "label": forecast["label"],
    }


@router.post("/{session_id}/weather/record")
async def record_session_weather(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Capture current conditions and save as the session's recorded weather.

    Admin-only. Typically called after the session ends.
    """
    result = await db.execute(select(GameSession).where(GameSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.latitude is None or session.longitude is None:
        raise HTTPException(status_code=400, detail="Session has no coordinates")

    current = await weather_service.fetch_current(
        session.latitude, session.longitude
    )
    if current is None:
        raise HTTPException(status_code=502, detail="Weather service unavailable")

    session.weather_actual_temp_c = current["temp_c"]
    session.weather_actual_code = current["weather_code"]
    session.weather_actual_label = current["label"]
    session.weather_actual_recorded_at = datetime.utcnow()

    await db.commit()

    return {
        "status": "ok",
        "temperature_c": current["temp_c"],
        "weather_code": current["weather_code"],
        "label": current["label"],
    }
