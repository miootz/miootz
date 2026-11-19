"""Peer voting restrictions across lineups and substitutions."""

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import ratings
from app.api.main import app  # noqa: F401 - register the complete database model
from app.core.database import Base
from sqlalchemy import select

from app.models.guest_plus_one import GuestPlusOne
from app.models.match import MatchSubstitution, MeetupMatch
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.schemas.rating import RatingCreate
from app.services.peer_rating_policy import teammate_pairs
from app.services import web_push
from app.services import guest_claims


@pytest.fixture
async def peer_data():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        users = [User(id=i, sso_display_name=f"Player {i}") for i in range(1, 8)]
        meetup = Meetup(
            start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=5),
            location="Pitch",
        )
        db.add_all([*users, meetup])
        await db.flush()
        db.add_all([Attendance(meetup_id=meetup.id, user_id=user.id) for user in users])
        first = MeetupMatch(
            meetup_id=meetup.id,
            match_number=1,
            team_a_name="A",
            team_b_name="B",
            team_a_users=json.dumps([1, 5]),
            team_b_users=json.dumps([3, 4]),
            status="completed",
        )
        db.add_all(
            [
                first,
                MeetupMatch(
                    meetup_id=meetup.id,
                    match_number=2,
                    team_a_name="A",
                    team_b_name="B",
                    team_a_users=json.dumps([6, 3]),
                    team_b_users=json.dumps([1, 4]),
                    status="completed",
                ),
                MeetupMatch(
                    meetup_id=meetup.id,
                    match_number=3,
                    team_a_name="A",
                    team_b_name="B",
                    team_a_users=json.dumps([1, 6]),
                    team_b_users=json.dumps([2, 3]),
                    status="pending",
                ),
            ]
        )
        await db.flush()
        db.add_all(
            [
                MatchSubstitution(
                    meetup_id=meetup.id,
                    match_id=first.id,
                    recorded_by=1,
                    old_team_a_users=json.dumps([1, 6]),
                    old_team_b_users=json.dumps([3, 4]),
                    new_team_a_users=json.dumps([1, 2]),
                    new_team_b_users=json.dumps([3, 4]),
                    clock_secs=None,
                ),
                MatchSubstitution(
                    meetup_id=meetup.id,
                    match_id=first.id,
                    recorded_by=1,
                    old_team_a_users=json.dumps([1, 2]),
                    old_team_b_users=json.dumps([3, 4]),
                    new_team_a_users=json.dumps([1, 5]),
                    new_team_b_users=json.dumps([3, 4]),
                    clock_secs=300,
                ),
            ]
        )
        await db.commit()
        yield db, meetup, users
    await engine.dispose()


async def test_teammates_include_substitutes_and_only_completed_lineups(peer_data):
    db, meetup, _ = peer_data
    pairs = (await teammate_pairs(db, [meetup.id]))[meetup.id]
    assert {(1, 2), (1, 5), (2, 5), (1, 4), (3, 4), (3, 6)} <= pairs
    assert (1, 3) not in pairs
    assert (1, 6) not in pairs
    assert await teammate_pairs(db, []) == {}


async def test_rating_modes_limit_context_and_submission(peer_data, monkeypatch):
    db, meetup, users = peer_data
    mode = SimpleNamespace(peer_rating_mode="teammates-only")
    monkeypatch.setattr(ratings, "get_rating_settings", AsyncMock(return_value=mode))
    monkeypatch.setattr(ratings, "update_user_calculated_skill", AsyncMock())
    monkeypatch.setattr(ratings, "log_action", lambda *args, **kwargs: None)
    request = SimpleNamespace()

    context = await ratings.get_rating_context(meetup.id, db, users[0])
    assert context.peer_rating_mode == "teammates-only"
    assert {ratee.user_id for ratee in context.ratees} == {2, 4, 5}
    await ratings.upsert_rating(
        RatingCreate(meetup_id=meetup.id, ratee_id=5, score=4),
        request,
        db,
        users[0],
    )
    with pytest.raises(HTTPException, match="teammates"):
        await ratings.upsert_rating(
            RatingCreate(meetup_id=meetup.id, ratee_id=3, score=4),
            request,
            db,
            users[0],
        )

    mode.peer_rating_mode = "everyone"
    context = await ratings.get_rating_context(meetup.id, db, users[0])
    assert {ratee.user_id for ratee in context.ratees} == {2, 3, 4, 5, 6, 7}
    await ratings.upsert_rating(
        RatingCreate(meetup_id=meetup.id, ratee_id=3, score=4),
        request,
        db,
        users[0],
    )
    mode.peer_rating_mode = "teammates-only"
    await ratings.upsert_rating(
        RatingCreate(meetup_id=meetup.id, ratee_id=3, score=0),
        request,
        db,
        users[0],
    )

    mode.peer_rating_mode = "off"
    context = await ratings.get_rating_context(meetup.id, db, users[0])
    assert context.peer_rating_mode == "off"
    assert context.ratees == []
    assert not context.ratings_editable
    with pytest.raises(HTTPException, match="disabled"):
        await ratings.upsert_rating(
            RatingCreate(meetup_id=meetup.id, ratee_id=5, score=0),
            request,
            db,
            users[0],
        )


async def test_reminders_follow_peer_mode(peer_data, monkeypatch):
    db, meetup, _ = peer_data
    mode = SimpleNamespace(peer_rating_mode="off")
    send = AsyncMock()
    monkeypatch.setattr(web_push.settings, "VAPID_PRIVATE_KEY", "private")
    monkeypatch.setattr(web_push.settings, "VAPID_PUBLIC_KEY", "public")
    monkeypatch.setattr(web_push, "get_rating_settings", AsyncMock(return_value=mode))
    monkeypatch.setattr(web_push, "_send_push_to_users", send)
    await web_push.notify_rating_reminder_for_meetup(db, meetup)
    send.assert_not_awaited()

    mode.peer_rating_mode = "teammates-only"
    await web_push.notify_rating_reminder_for_meetup(db, meetup)
    assert send.await_args.args[1] == {1, 2, 3, 4, 5, 6}

    mode.peer_rating_mode = "everyone"
    await web_push.notify_rating_reminder_for_meetup(db, meetup)
    assert send.await_args.args[1] == {1, 2, 3, 4, 5, 6, 7}


async def test_claim_transfers_the_guest_in_substitution_snapshots(
    peer_data, monkeypatch
):
    db, meetup, users = peer_data
    sub = await db.scalar(
        select(MatchSubstitution).where(MatchSubstitution.clock_secs.is_not(None))
    )
    sub.old_team_a_users = json.dumps([1, 7])
    member = User(id=8, sso_display_name="Member")
    reservation = GuestPlusOne(
        meetup_id=meetup.id,
        inviter_id=1,
        guest_user_id=users[6].id,
        first_name="Guest",
        last_name="Player",
        skill=3,
        claim_token="guest-claim",
    )
    db.add_all([member, reservation])
    await db.commit()
    monkeypatch.setattr(guest_claims, "refresh_skills_after_meetup", AsyncMock())
    monkeypatch.setattr(guest_claims, "update_user_calculated_skill", AsyncMock())
    assert (1, 7) in (await teammate_pairs(db, [meetup.id]))[meetup.id]
    await guest_claims.claim_reservation(db, reservation, member)
    pairs = (await teammate_pairs(db, [meetup.id]))[meetup.id]
    assert json.loads(sub.old_team_a_users) == [1, 8]
    assert (1, 8) in pairs
    assert (1, 7) not in pairs
