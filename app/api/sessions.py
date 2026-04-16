from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi.responses import StreamingResponse
import json

from app.api.deps import require_admin
from app.core.database import get_db
from app.models.session import GameSession, Attendance
from app.models.user import User
from app.models.chat import ChatMessage
from app.core.chat_manager import chat_manager
from app.services.session_promotion import handle_leave_or_cancel
from app.services.team_assignment import assign_teams_snake

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionCreate(BaseModel):
    start_time: datetime
    location: str
    fee: float = 0.0
    min_players: int = Field(default=10, ge=1, le=50)
    max_players: int = Field(default=15, ge=1, le=50)
    latitude: float | None = None
    longitude: float | None = None
    waitlist_mode: str = Field(default="auto_promote")

    @field_validator("waitlist_mode")
    @classmethod
    def mode_ok(cls, v: str) -> str:
        if v.lower() not in ("broadcast", "auto_promote"):
            raise ValueError("waitlist_mode must be 'broadcast' or 'auto_promote'")
        return v.lower()

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


class ChatMessageCreate(BaseModel):
    message: str


def _user_skill(u: User) -> float:
    v = u.calculated_skill or u.skill_level or u.self_assessed_skill
    return float(v) if v is not None else 50.0


@router.post("/", status_code=201)
async def create_session(
    session_data: SessionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    payload = session_data.model_dump()
    new_session = GameSession(**payload)
    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)
    return new_session


@router.get("/", response_model=list[dict])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GameSession).order_by(GameSession.start_time.asc()))
    sessions = result.scalars().all()
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
        }
        for s in sessions
    ]


@router.get("/{session_id}")
async def get_session(session_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GameSession).where(GameSession.id == session_id))
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
                "status": att.status,
                "joined_at": att.joined_at.isoformat() if att.joined_at else None,
                "skill": _user_skill(user),
            }
        )

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
        "attendees": attendees,
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
        }
        for _, user in rows
    ]
    teams = assign_teams_snake(players)
    out = []
    for i, team in enumerate(teams, start=1):
        out.append(
            {
                "id": f"t{i}",
                "players": [
                    {
                        "id": p["id"],
                        "name": p["name"],
                        "skillScore": p["skill"],
                        "isLocked": False,
                    }
                    for p in team
                ],
            }
        )
    return {"session_id": session_id, "teams": out}


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

    for key, value in data.items():
        setattr(session, key, value)

    await db.commit()
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
            await db.commit()
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
    await db.commit()
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
    await db.commit()

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
    await db.commit()
    return {"status": "moved"}


@router.post("/reminders/run-now")
async def run_weekly_reminder_now(_: User = Depends(require_admin)):
    """Manual trigger for the Tuesday reminder job (admin)."""
    from app.services.jobs import weekly_session_reminder_job

    await weekly_session_reminder_job()
    return {"status": "ok"}


@router.delete("/{session_id}")
async def delete_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    session = await db.get(GameSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    return {"status": "deleted"}


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
    return [
        {
            "id": m.id,
            "user_id": m.user_id,
            "username": m.user.username if m.user else "Unknown",
            "message": m.message,
            "created_at": m.created_at,
        }
        for m in messages
    ]


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

    broadcast_data = {
        "id": new_msg.id,
        "user_id": new_msg.user_id,
        "username": request.state.user.username
        if hasattr(request.state.user, "username")
        else "Unknown",
        "message": new_msg.message,
        "created_at": new_msg.created_at.isoformat(),
    }
    await chat_manager.broadcast(session_id, broadcast_data)

    return {"status": "sent", "message_id": new_msg.id}
