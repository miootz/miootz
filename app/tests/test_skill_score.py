import json
import pytest
from datetime import datetime, timedelta, UTC
from httpx import ASGITransport, AsyncClient

from app.api.main import app
from app.core.database import Base, async_session, engine
from app.models.match import MatchPenalty, MeetupMatch
from app.models.match_goal import MatchGoal
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.services import skill_service
from app.services.jobs import send_rating_reminder_for_meetup
from app.services.skill_service import update_user_calculated_skill
from app.services.team_assignment import draft_skill


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.mark.asyncio
async def test_skill_score_calculation_logic():
    async with async_session() as db:
        auth_user = User(
            pocket_id_sub="tester-uuid",
            sso_display_name="tester",
        )
        # Seed rating as an admin would at player creation.
        player = User(
            pocket_id_sub="test-p1", sso_display_name="p1", calculated_skill=3.0
        )
        rater1 = User(pocket_id_sub="test-r1", sso_display_name="r1")
        db.add_all([auth_user, player, rater1])
        await db.commit()
        await db.refresh(auth_user)
        await db.refresh(player)
        await db.refresh(rater1)

        meetup1 = Meetup(
            start_time=datetime.now(UTC) - timedelta(hours=48),
            location="Park 1",
            max_players=10,
        )
        db.add(meetup1)
        await db.commit()
        await db.refresh(meetup1)

        s1id = meetup1.id
        for uid in (rater1.id, player.id, auth_user.id):
            db.add(Attendance(meetup_id=s1id, user_id=uid))
        await db.commit()

        player_id = player.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/ratings/",
            headers={"Authorization": "Bearer tester"},
            json={
                "meetup_id": s1id,
                "ratee_id": player_id,
                "score": 5,
            },
        )
        assert resp.status_code == 200, f"rating failed: {resp.text}"

    async with async_session() as db:
        player_row = await db.get(User, player_id)
        assert player_row is not None
        # Peer votes overwrite the admin seed: single rating of 5.
        assert player_row.calculated_skill == 5.0


@pytest.mark.asyncio
async def test_seed_skill_persists_without_peer_ratings():
    async with async_session() as db:
        player = User(
            pocket_id_sub="test-p1", sso_display_name="p1", calculated_skill=3.0
        )
        db.add(player)
        await db.commit()
        await db.refresh(player)

        await update_user_calculated_skill(db, user_id=player.id)

        player_row = await db.get(User, player.id)
        assert player_row is not None
        # No peer ratings: the admin seed is left untouched.
        assert player_row.calculated_skill == 3.0


async def test_meetup_refresh_rewards_completed_matches_and_decays_absent_players(
    monkeypatch,
):
    kickoff = datetime(2026, 1, 5, 18, tzinfo=UTC)
    now = kickoff + timedelta(hours=1)
    monkeypatch.setattr(skill_service, "_utc_now", lambda: now)

    async with async_session() as db:
        scorer, assister, keeper, opponent = [
            User(sso_display_name=name, calculated_skill=3.0)
            for name in ("Scorer", "Assister", "Keeper", "Opponent")
        ]
        unrated = User(sso_display_name="Unrated")
        first = Meetup(
            start_time=kickoff, location="Pitch", max_players=10, duration_minutes=60
        )
        later = Meetup(
            start_time=kickoff + timedelta(weeks=3),
            location="Pitch",
            max_players=10,
            duration_minutes=60,
        )
        db.add_all([scorer, assister, keeper, opponent, unrated, first, later])
        await db.flush()
        home = json.dumps([scorer.id, assister.id, keeper.id, unrated.id])
        away = json.dumps([opponent.id])
        match = MeetupMatch(
            meetup_id=first.id,
            match_number=1,
            team_a_users=home,
            team_b_users=away,
            team_a_name="Home",
            team_b_name="Away",
            score_a=3,
            score_b=0,
            status="completed",
        )
        db.add_all(
            [
                match,
                MeetupMatch(
                    meetup_id=first.id,
                    match_number=2,
                    team_a_users=home,
                    team_b_users=away,
                    team_a_name="Home",
                    team_b_name="Away",
                    score_a=1,
                    score_b=1,
                    status="completed",
                ),
            ]
        )
        await db.flush()
        for minute in range(1, 4):
            db.add(
                MatchGoal(
                    match_id=match.id,
                    team="a",
                    clock_minute=minute,
                    clock_secs=0,
                    scorer_id=opponent.id if minute == 3 else scorer.id,
                    assist_id=assister.id if minute == 1 else None,
                    is_own_goal=minute == 3,
                    is_penalty=minute == 2,
                    recorded_by=scorer.id,
                    intent_id=f"goal-{minute}",
                )
            )
        db.add(
            MatchPenalty(
                match_id=match.id, team="b", scored=True, scorer_id=opponent.id
            )
        )
        user_ids = [
            player.id for player in (scorer, assister, keeper, opponent, unrated)
        ]
        first_id, later_id, match_id = first.id, later.id, match.id
        await db.commit()

    async def skills():
        async with async_session() as db:
            players = [await db.get(User, user_id) for user_id in user_ids]
            return [
                (player.calculated_skill, player.match_skill_bonus or 0)
                for player in players
            ]

    weight = 0.5 ** (timedelta(hours=1) / timedelta(weeks=3))
    await send_rating_reminder_for_meetup(first_id)
    first_skills = await skills()
    assert [skill for skill, _ in first_skills] == [3.1, 3.1, 3, 3, None]
    assert [bonus for _, bonus in first_skills] == pytest.approx(
        [points * weight / (3 + 2 * weight) for points in (0.6, 0.3, 0.1, 0, 0.1)]
    )
    await send_rating_reminder_for_meetup(first_id)
    assert await skills() == first_skills

    now += timedelta(weeks=3) - timedelta(minutes=1)
    # A refresh before the next meetup ends retains the previous decay cutoff.
    await send_rating_reminder_for_meetup(first_id)
    async with async_session() as db:
        await update_user_calculated_skill(db, user_id=user_ids[0])
    assert await skills() == first_skills

    now += timedelta(minutes=1)
    await send_rating_reminder_for_meetup(later_id)
    assert (await skills())[0][1] == pytest.approx(0.6 * (weight / 2) / (3 + weight))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.patch(
            f"/meetups/{first_id}/matches/{match_id}/score",
            headers={"Authorization": "Bearer admin"},
            json={"score_a": 3, "score_b": 1},
        )
    assert response.status_code == 200, response.text
    assert (await skills())[2] == (3.0, 0.0)


def test_draft_skill_uses_three_for_unrated_players_and_preserves_zero():
    assert draft_skill(None) == 3.0
    assert draft_skill(0.0) == 0.0
