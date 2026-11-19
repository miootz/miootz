import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.match import MatchPenalty, MatchSubstitution, MeetupMatch
from app.models.match_goal import MatchGoal
from app.models.meetup import Meetup
from app.models.user import User
from app.services import player_attributes


@pytest.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


def test_attribute_scale_and_fresh_empty_values():
    score = player_attributes._score
    assert [score(rate, 0.30, 0.85) for rate in (0, 0.30, 0.85, 1)] == [1, 3, 5, 5]
    assert all(
        isinstance(score(rate, 0.30, 0.85), float) for rate in (0, 0.30, 0.85, 1)
    )
    first = player_attributes.empty_player_attributes()
    second = player_attributes.empty_player_attributes()
    first["sho"]["sample"] = 1
    assert second["sho"]["sample"] == 0
    assert set(second) == {"sho", "pas", "def"}


@pytest.fixture
async def match_history(db, monkeypatch):
    monkeypatch.setattr(
        player_attributes, "utc_now", lambda: datetime(2026, 4, 1, tzinfo=UTC)
    )
    alice, bob, opponent, excluded, previous = [
        User(sso_display_name=name)
        for name in ("Alice", "Bob", "Opponent", "Excluded", "Previous")
    ]
    kickoff = datetime(2026, 1, 1, 18)
    meetups = [
        Meetup(
            start_time=kickoff + timedelta(days=offset),
            location="Pitch",
            max_players=10,
        )
        for offset in (0, 21, 42, 63)
    ]
    skipped = Meetup(
        start_time=kickoff + timedelta(days=84),
        location="Pitch",
        max_players=10,
        skipped=True,
    )
    future = Meetup(start_time=datetime(2026, 5, 1), location="Pitch", max_players=10)
    prior = Meetup(
        start_time=datetime(2025, 12, 31, 23, 30), location="Pitch", max_players=10
    )
    db.add_all(
        [alice, bob, opponent, excluded, previous, *meetups, skipped, future, prior]
    )
    await db.flush()

    home = json.dumps([alice.id, bob.id])
    away = json.dumps([opponent.id])
    matches = []
    for index, meetup in enumerate(
        [meetups[0]] * 3 + [meetups[1]] * 3 + [meetups[2]] * 2
    ):
        number = index % 3 + 1
        match = MeetupMatch(
            meetup_id=meetup.id,
            match_number=number,
            team_a_users=home,
            team_b_users=away,
            team_a_name="Home",
            team_b_name="Away",
            score_a=2,
            score_b=0,
            status="completed",
        )
        db.add(match)
        await db.flush()
        db.add_all(
            [
                MatchGoal(
                    match_id=match.id,
                    team="a",
                    scorer_id=alice.id,
                    assist_id=bob.id,
                    recorded_by=alice.id,
                    clock_secs=60,
                    clock_minute=1,
                    intent_id=f"known-{index}",
                ),
                MatchGoal(
                    match_id=match.id,
                    team="a",
                    scorer_id=bob.id,
                    recorded_by=alice.id,
                    clock_secs=30,
                    clock_minute=2,
                    intent_id=f"blank-{index}",
                ),
            ]
        )
        matches.append(match)

    matches[0].score_a = 4
    db.add_all(
        [
            MatchGoal(
                match_id=matches[0].id,
                team="a",
                scorer_id=opponent.id,
                is_own_goal=True,
                recorded_by=alice.id,
                clock_secs=20,
                clock_minute=3,
                intent_id="own",
            ),
            MatchGoal(
                match_id=matches[0].id,
                team="a",
                scorer_id=alice.id,
                is_penalty=True,
                assist_id=bob.id,
                recorded_by=alice.id,
                clock_secs=10,
                clock_minute=4,
                intent_id="penalty",
            ),
            MatchGoal(
                match_id=matches[0].id,
                team="a",
                scorer_id=alice.id,
                assist_id=bob.id,
                recorded_by=alice.id,
                clock_secs=5,
                clock_minute=5,
                intent_id="deleted",
                deleted_at=kickoff,
            ),
            MatchPenalty(
                match_id=matches[0].id, team="a", scored=True, scorer_id=alice.id
            ),
            MatchSubstitution(
                meetup_id=meetups[0].id,
                match_id=matches[0].id,
                old_team_a_users=json.dumps([excluded.id, bob.id]),
                old_team_b_users=away,
                new_team_a_users=home,
                new_team_b_users=away,
                recorded_by=alice.id,
            ),
            MeetupMatch(
                meetup_id=meetups[2].id,
                match_number=3,
                team_a_users=home,
                team_b_users=away,
                team_a_name="Home",
                team_b_name="Away",
                score_a=0,
                score_b=1,
                status="completed",
            ),
        ]
    )
    mid_match = MeetupMatch(
        meetup_id=meetups[2].id,
        match_number=4,
        team_a_users=json.dumps([excluded.id]),
        team_b_users=away,
        team_a_name="Home",
        team_b_name="Away",
        status="completed",
    )
    db.add(mid_match)
    await db.flush()
    db.add(
        MatchSubstitution(
            meetup_id=meetups[2].id,
            match_id=mid_match.id,
            old_team_a_users=json.dumps([excluded.id]),
            old_team_b_users=away,
            new_team_a_users=json.dumps([excluded.id]),
            new_team_b_users=away,
            recorded_by=alice.id,
            clock_secs=0,
        )
    )
    for meetup, status, player in (
        (skipped, "completed", excluded),
        (future, "completed", excluded),
        (meetups[2], "pending", excluded),
        (prior, "completed", previous),
    ):
        db.add(
            MeetupMatch(
                meetup_id=meetup.id,
                match_number=5,
                team_a_users=json.dumps([player.id]),
                team_b_users=away,
                team_a_name="Home",
                team_b_name="Away",
                status=status,
                completed_at=datetime(2026, 1, 1, 0, 30),
            )
        )
    await db.flush()
    return alice, bob, opponent, excluded, previous, matches


async def test_attributes_use_scoped_finished_matches_and_decay(db, match_history):
    alice, bob, opponent, excluded, previous, _ = match_history
    attributes = await player_attributes.load_player_attributes(db, year=2026)
    assert set(attributes) == {alice.id, bob.id, opponent.id}
    assert attributes[alice.id] == {
        "sho": {"score": 3.9, "count": 8, "sample": 8, "meetups": 3},
        "pas": {"score": 2.6, "count": 0, "sample": 8, "meetups": 3, "total_goals": 16},
        "def": {"score": 3.6, "count": 8, "sample": 9, "meetups": 3},
    }
    assert attributes[bob.id]["pas"] == {
        "score": 4.3,
        "count": 8,
        "sample": 8,
        "meetups": 3,
        "total_goals": 16,
    }
    assert attributes[opponent.id]["pas"] == {
        "score": None,
        "count": 0,
        "sample": 0,
        "meetups": 0,
        "total_goals": 0,
    }
    prior = await player_attributes.load_player_attributes(db, year=2025)
    assert set(prior) == {previous.id, opponent.id}
    assert prior[previous.id]["sho"]["sample"] == 1
    assert excluded.id not in await player_attributes.load_player_attributes(db)


async def test_passing_gates_preserve_evidence(db, match_history):
    alice, bob, _, _, _, matches = match_history
    goals = list(await db.scalars(select(MatchGoal)))
    known = {
        goal.intent_id: goal for goal in goals if goal.intent_id.startswith("known-")
    }
    blank = {
        goal.intent_id: goal for goal in goals if goal.intent_id.startswith("blank-")
    }

    # Keep eight credited goals and 50% coverage, but remove the third meetup.
    known["known-6"].assist_id = known["known-7"].assist_id = None
    blank["blank-0"].assist_id = blank["blank-1"].assist_id = bob.id
    await db.flush()
    passing = (await player_attributes.load_player_attributes(db, year=2026))[bob.id][
        "pas"
    ]
    assert passing == {
        "score": None,
        "count": 8,
        "sample": 8,
        "meetups": 2,
        "total_goals": 16,
    }

    # Restore three meetups and add one uncredited goal: coverage falls below 50%.
    known["known-6"].assist_id = bob.id
    blank["blank-0"].assist_id = None
    matches[0].score_a += 1
    db.add(
        MatchGoal(
            match_id=matches[0].id,
            team="a",
            scorer_id=alice.id,
            recorded_by=alice.id,
            clock_secs=0,
            clock_minute=6,
            intent_id="extra-blank",
        )
    )
    await db.flush()
    passing = (await player_attributes.load_player_attributes(db, year=2026))[bob.id][
        "pas"
    ]
    assert passing == {
        "score": None,
        "count": 8,
        "sample": 8,
        "meetups": 3,
        "total_goals": 17,
    }


async def test_sample_and_meetup_gates_are_independent(db, match_history):
    _, bob, _, _, _, matches = match_history
    goals = list(await db.scalars(select(MatchGoal)))
    known = next(goal for goal in goals if goal.intent_id == "known-0")
    blank = next(goal for goal in goals if goal.intent_id == "blank-0")
    known.deleted_at = blank.deleted_at = datetime(2026, 1, 1)
    matches[0].score_a -= 2
    await db.flush()
    passing = (await player_attributes.load_player_attributes(db, year=2026))[bob.id][
        "pas"
    ]
    assert passing == {
        "score": None,
        "count": 7,
        "sample": 7,
        "meetups": 3,
        "total_goals": 14,
    }

    mismatch = await db.scalar(
        select(MeetupMatch).where(
            MeetupMatch.meetup_id == matches[6].meetup_id, MeetupMatch.match_number == 3
        )
    )
    mismatch.status = "pending"
    for index, match in enumerate(matches[6:], start=4):
        match.meetup_id = matches[3].meetup_id
        match.match_number = index
    await db.flush()
    attrs = (await player_attributes.load_player_attributes(db, year=2026))[bob.id]
    assert attrs["sho"] == {"score": None, "count": 7, "sample": 8, "meetups": 2}
    assert attrs["def"] == {"score": None, "count": 8, "sample": 8, "meetups": 2}
