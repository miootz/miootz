from datetime import datetime, UTC
import json

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base
from app.demo_data import seed_demo, SCENARIOS
from app.models.game_template import GameTemplate
from app.models.meetup import Attendance, Meetup
from app.models.match import MeetupMatch
from app.models.match_goal import MatchGoal
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
            16 if scenario in ("live", "kickoff")
            else 15 if scenario in ("full", "broadcast")
            else 12
        )
        assert manifest["waitlisted"] == (3 if scenario in ("full", "broadcast") else 0)
        current = await db.get(Meetup, 1)
        recent = await db.get(Meetup, 2)
        assert current is not None
        assert recent is not None
        template = await db.get(GameTemplate, 1)
        assert template is not None
        assert template.weekday == 0 and (template.hour, template.minute) == (20, 0)
        assert template.fee == 25 and template.fee_text == "8 credits"
        assert template.location.startswith("Football Academy")
        assert current.fee_text == "8 credits"
        assert current.start_time >= anchor
        if scenario == "kickoff":
            # In progress: starts at the run's now; first round is prepared.
            assert current.start_time == anchor
            assert (
                await db.scalars(
                    select(MeetupMatch.status).where(MeetupMatch.meetup_id == 1)
                )
            ).all() == ["pending"]
            # Ratings lock at the next kickoff, which is exactly now.
            assert may_rate_or_edit(
                anchor.replace(tzinfo=UTC), recent, current.start_time
            ) == (False, "Ratings for this meetup are locked")
        else:
            assert may_rate_or_edit(
                anchor.replace(tzinfo=UTC), recent, current.start_time
            ) == (True, None)
        assert await db.scalar(select(func.count()).select_from(ChatMessage)) == 5
        assert await db.scalar(select(func.count()).select_from(GuestPlusOne)) == 1
        confirmed = set(
            (
                await db.scalars(
                    select(Attendance.user_id).where(
                        Attendance.meetup_id == 1, Attendance.status == "confirmed"
                    )
                )
            ).all()
        )
        assert current.manual_teams_json
        teams = json.loads(current.manual_teams_json)
        assert set(uid for team in teams for uid in team) == confirmed
        assert sum(len(team) for team in teams) == len(confirmed)
        if scenario in ("live", "kickoff"):
            # 3 teams of 5 + a 1-player bench pool.
            assert sorted(len(team) for team in teams) == [1, 5, 5, 5]
        else:
            assert max(map(len, teams)) - min(map(len, teams)) <= 1
        assert await db.scalar(select(func.count()).select_from(MeetupMatch)) == (
            19 if scenario in ("live", "kickoff") else 18
        )
        matches = list(await db.scalars(select(MeetupMatch)))
        goals = list(await db.scalars(select(MatchGoal)))
        assert len(goals) == 45  # 15 per past meetup: score_a totals 12, score_b totals 3
        for match in matches:
            if match.status != "completed":
                continue
            team_a = set(json.loads(match.team_a_users))
            team_b = set(json.loads(match.team_b_users))
            match_goals = [g for g in goals if g.match_id == match.id]
            assert sum(1 for g in match_goals if g.team == "a") == match.score_a
            assert sum(1 for g in match_goals if g.team == "b") == match.score_b
            for g in match_goals:
                scoring, conceding = (team_a, team_b) if g.team == "a" else (team_b, team_a)
                if g.is_own_goal:
                    assert g.scorer_id in conceding
                    assert g.assist_id is None
                else:
                    assert g.scorer_id in scoring
                    assert g.assist_id in scoring and g.assist_id != g.scorer_id
                assert g.goalkeeper_id in conceding and g.goalkeeper_id != g.scorer_id
        # Every listed keeper (GK) and the fallback defender got scored on.
        assert {5, 8, 12} <= {g.goalkeeper_id for g in goals}
        own = [g for g in goals if g.is_own_goal]
        assert len(own) == 2
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
