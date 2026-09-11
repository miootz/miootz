from datetime import datetime, UTC
import json

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base
from app.demo_data import seed_demo, SCENARIOS
from app.models.session import Attendance, GameSession
from app.models.match import SessionMatch
from app.models.guest_plus_one import GuestPlusOne
from app.models.chat import ChatMessage
from app.models.user import User
from app.services.rating_windows import may_rate_or_edit


@pytest.mark.asyncio
@pytest.mark.parametrize("scenario", SCENARIOS)
async def test_demo_scenarios_have_complete_repeatable_states(scenario):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    anchor = datetime(2026, 9, 8, 12)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        manifest = await seed_demo(db, anchor=anchor, scenario=scenario)
        assert manifest["confirmed"] == (
            15 if scenario in ("full", "broadcast") else 12
        )
        assert manifest["waitlisted"] == (3 if scenario in ("full", "broadcast") else 0)
        current = await db.get(GameSession, 1)
        recent = await db.get(GameSession, 2)
        assert current is not None
        assert recent is not None
        assert current.start_time > anchor
        assert may_rate_or_edit(
            anchor.replace(tzinfo=UTC), recent, current.start_time
        ) == (True, None)
        assert await db.scalar(select(func.count()).select_from(ChatMessage)) == 5
        assert await db.scalar(select(func.count()).select_from(GuestPlusOne)) == 1
        confirmed = set(
            (
                await db.scalars(
                    select(Attendance.user_id).where(
                        Attendance.session_id == 1, Attendance.status == "confirmed"
                    )
                )
            ).all()
        )
        assert current.manual_teams_json
        teams = json.loads(current.manual_teams_json)
        assert set(uid for team in teams for uid in team) == confirmed
        assert sum(len(team) for team in teams) == len(confirmed)
        assert max(map(len, teams)) - min(map(len, teams)) <= 1
        assert await db.scalar(select(func.count()).select_from(SessionMatch)) == (
            19 if scenario == "live" else 18
        )
        u20 = await db.get(User, 20)
        u21 = await db.get(User, 21)
        assert u20 is not None and u21 is not None
        assert u20.pocket_id_sub != u21.pocket_id_sub
        assert current.waitlist_mode == (
            "broadcast" if scenario == "broadcast" else "auto_promote"
        )
        with pytest.raises(ValueError, match="empty database"):
            await seed_demo(db, anchor=anchor, scenario=scenario)
    await engine.dispose()
