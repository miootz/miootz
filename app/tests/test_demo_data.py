from datetime import datetime, timedelta, UTC
import json

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base
from app.demo_data import seed_demo, SCENARIOS
from app.models.game_template import GameTemplate
from app.models.meetup import Attendance, Meetup
from app.models.rating import Rating
from app.models.match import MeetupMatch
from app.models.match_goal import MatchGoal
from app.models.guest_plus_one import GuestPlusOne
from app.models.chat import ChatMessage
from app.models.user import User
from app.services.rating_windows import may_rate_or_edit
from app.services.rating_settings import get_rating_settings


@pytest.mark.asyncio
@pytest.mark.parametrize("scenario", SCENARIOS)
async def test_demo_scenarios_have_complete_repeatable_states(scenario):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    anchor = datetime(2024, 4, 2, 12)
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
        assert template.weekday == 4 and (template.hour, template.minute) == (18, 30)
        assert template.fee == 8 and template.fee_text == "8 credits"
        assert template.location == "Example Sports Centre"
        assert current.fee_text == "8 credits"
        if scenario == "live":
            # In progress: started 20 min before the run's now, so the
            # presence window (T-15 min head) is open around the live match.
            assert current.start_time == anchor - timedelta(minutes=20)
            assert (
                await db.scalars(
                    select(MeetupMatch.status).where(MeetupMatch.meetup_id == 1)
                )
            ).all() == ["active"]
        elif scenario == "kickoff":
            # In progress: starts at the run's now; first round is prepared.
            assert current.start_time == anchor
            assert (
                await db.scalars(
                    select(MeetupMatch.status).where(MeetupMatch.meetup_id == 1)
                )
            ).all() == ["pending"]
        else:
            assert current.start_time >= anchor
        if scenario in ("live", "kickoff"):
            # The kickoff has passed, so the recent meetup's ratings lock.
            assert may_rate_or_edit(
                anchor.replace(tzinfo=UTC), recent, current.start_time
            ) == (False, "Ratings for this meetup are locked")
        else:
            assert may_rate_or_edit(
                anchor.replace(tzinfo=UTC), recent, current.start_time
            ) == (True, None)
        assert await db.scalar(select(func.count()).select_from(ChatMessage)) == 5
        assert await db.scalar(select(func.count()).select_from(GuestPlusOne)) == 1
        attendance = list(
            await db.scalars(select(Attendance).where(Attendance.meetup_id == 1))
        )
        assert len({row.user_id for row in attendance}) == len(attendance)
        confirmed = {row.user_id for row in attendance if row.status == "confirmed"}
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
        assert len(goals) == 45  # 15 per past meetup.
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
        assert u20.sso_display_name == u21.sso_display_name == "Marco van Basten"
        assert u20.primary_specialty == u21.primary_specialty == "ATT"
        if scenario == "full":
            users = {user.id: user for user in await db.scalars(select(User))}
            assert (users[1].seed_skill, users[1].pac, users[1].dri) == (4.2, 2.5, 4.0)
            assert all(users[uid].pac == users[uid].dri == 4.0 for uid in (7, 15, 16, 18, 19))
            assert users[8].dri is None  # Buffon's card uses the goalkeeper scale.
            assert users[14].seed_skill is None
            assert (await get_rating_settings(db)).peer_rating_mode == "teammates-only"
            for attribute in ("pac", "dri"):
                counts = [
                    sum((getattr(users[uid], attribute) or 3.0) > 3.0 for uid in team)
                    for team in teams
                ]
                assert max(counts) - min(counts) <= 1

            past_votes = (await db.scalars(select(Rating).where(Rating.meetup_id == 2))).all()
            assert len({vote.score for vote in past_votes}) >= 4
            assert all(vote.rater_id != 2 for vote in past_votes)
            assert all((vote.rater_id - 1) // 5 == (vote.ratee_id - 1) // 5 for vote in past_votes)
            assert len({vote.rater_id for vote in past_votes if vote.ratee_id == 5}) < 3
            assert len({vote.rater_id for vote in past_votes if vote.ratee_id == 2}) == 4
            assert users[1].calculated_skill == 3.8
            assert users[2].calculated_skill != users[2].seed_skill
        assert current.waitlist_mode == (
            "broadcast" if scenario == "broadcast" else "auto_promote"
        )
        with pytest.raises(ValueError, match="empty database"):
            await seed_demo(db, anchor=anchor, scenario=scenario)
    await engine.dispose()
