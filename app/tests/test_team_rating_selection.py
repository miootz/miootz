from datetime import datetime
from types import SimpleNamespace

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.main import app  # noqa: F401 - registers all model tables
from app.api.meetups import get_meetup, get_meetup_teams
from app.core.database import Base
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.services.rating_settings import RatingSettings
from app.services.team_adjustment import _load_meetup_players


async def test_team_rosters_use_selected_rating_and_carry_attributes():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            users = [
                User(id=1, sso_display_name="A", seed_skill=0, calculated_skill=4, pac=4),
                User(id=2, sso_display_name="B", seed_skill=2, calculated_skill=3, dri=4),
                User(id=3, sso_display_name="C", seed_skill=5, calculated_skill=1),
                User(id=4, sso_display_name="D", seed_skill=None, calculated_skill=2),
            ]
            meetup = Meetup(id=1, start_time=datetime(2026, 11, 19), location="Pitch")
            settings = RatingSettings(id=1, computed_scores=True, peer_rating_mode="everyone")
            db.add_all([*users, meetup, settings])
            await db.flush()
            db.add_all([Attendance(meetup_id=1, user_id=user.id) for user in users])
            await db.commit()

            async def team_players():
                result = await get_meetup_teams(1, db)
                return {int(p["id"]): p for team in result["teams"] for p in team["players"]}

            adjusted = await team_players()
            assert {uid: row["skillScore"] for uid, row in adjusted.items()} == {
                1: 4, 2: 3, 3: 1, 4: 2,
            }
            assert adjusted[1]["pac"] == 4
            assert adjusted[2]["dri"] == 4

            settings.computed_scores = False
            await db.flush()
            base = await team_players()
            assert {uid: row["skillScore"] for uid, row in base.items()} == {
                1: 0, 2: 2, 3: 5, 4: 3,
            }
            assert base[1]["calculatedSkill"] == 0
            assert base[4]["calculatedSkill"] is None
            confirmed, _ = await _load_meetup_players(db, 1)
            assert {row["user_id"]: row["skill"] for row in confirmed} == {
                1: 0, 2: 2, 3: 5, 4: 3,
            }
            detail = await get_meetup(1, SimpleNamespace(state=SimpleNamespace(user=None)), db)
            attendees = {row["user_id"]: row for row in detail["attendees"]}
            assert attendees[1]["skill"] == 0
            assert attendees[1]["pac"] == 4
            assert attendees[2]["dri"] == 4
    finally:
        await engine.dispose()
