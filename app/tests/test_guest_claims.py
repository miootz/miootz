"""Guest claims use a real member account and preserve the reserved place."""

import json
from datetime import datetime, timedelta, UTC
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.meetups import claim_plus_one as _claim_plus_one_route

# Direct-call unit tests bypass the slowapi wrapper, which insists on a real
# starlette Request; HTTP-level rate limiting is covered end-to-end in
# test_rate_limit.py through the ASGI stack.
claim_plus_one = getattr(_claim_plus_one_route, "__wrapped__", _claim_plus_one_route)
from app.core.database import Base
from app.models.guest_plus_one import GuestPlusOne
from app.models.match import MeetupMatch
from app.models.rating import Rating
from app.models.meetup import Attendance, Meetup, MatchScore
from app.models.user import User
from app.services.stats_service import get_user_statistics
from app.schemas.stats import UserStats


@pytest.fixture
async def claim_data():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        host = User(pocket_id_sub="host", self_assessed_skill=4)
        guest = User(pocket_id_sub="placeholder")
        member = User(
            pocket_id_sub="member", sso_display_name="Mara", self_assessed_skill=2
        )
        meetup = Meetup(
            start_time=datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1),
            location="Demo",
        )
        db.add_all([host, guest, member, meetup])
        await db.flush()
        joined_at = datetime(2026, 1, 1)
        attendance = Attendance(
            meetup_id=meetup.id,
            user_id=guest.id,
            status="confirmed",
            joined_at=joined_at,
        )
        reservation = GuestPlusOne(
            meetup_id=meetup.id,
            inviter_id=host.id,
            guest_user_id=guest.id,
            first_name="Demo",
            last_name="Guest",
            self_assessed_skill=3,
            claim_token="test-claim",
            status="pending",
        )
        meetup.manual_teams_json = json.dumps([[host.id], [guest.id]])
        match = MeetupMatch(
            meetup_id=meetup.id,
            match_number=1,
            team_a_users=json.dumps([host.id]),
            team_b_users=json.dumps([guest.id]),
            team_a_name="Violet",
            team_b_name="Mint",
            status="completed",
        )
        db.add_all(
            [
                attendance,
                reservation,
                match,
                Rating(
                    meetup_id=meetup.id, rater_id=host.id, ratee_id=guest.id, score=4
                ),
                MatchScore(
                    meetup_id=meetup.id, player_id=guest.id, score=2, type="team"
                ),
            ]
        )
        await db.commit()
        yield SimpleNamespace(
            db=db,
            host=host,
            guest=guest,
            member=member,
            meetup=meetup,
            attendance=attendance,
            reservation=reservation,
            match=match,
        )
    await engine.dispose()


async def claim(data, member=None):
    req = SimpleNamespace(state=SimpleNamespace(user=member or data.member))
    return await claim_plus_one("test-claim", req, data.db)  # pyright: ignore[reportArgumentType]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["confirmed", "waitlisted"])
async def test_claim_transfers_place_and_results_without_replacing_identity(
    claim_data, status
):
    d = claim_data
    d.attendance.status = status
    await d.db.commit()
    result = await claim(d)
    assert result["user_id"] == d.member.id
    assert result["display_name"] == "Mara"
    assert d.member.pocket_id_sub == "member"
    assert d.guest.pocket_id_sub == "placeholder"
    assert d.member.self_assessed_skill == 2
    assert d.attendance.user_id == d.member.id
    assert d.attendance.status == status
    assert d.attendance.joined_at == datetime(2026, 1, 1)
    assert json.loads(d.meetup.manual_teams_json)[1] == [d.member.id]
    assert json.loads(d.match.team_b_users) == [d.member.id]
    assert (await d.db.scalar(select(Rating))).ratee_id == d.member.id
    assert (await d.db.scalar(select(MatchScore))).player_id == d.member.id
    assert d.meetup.content_revision == 1
    assert d.reservation.claimed_by_user_id == d.member.id
    assert await claim(d) == result
    assert d.meetup.content_revision == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["confirmed", "waitlisted"])
async def test_existing_attendee_cannot_take_a_second_place(claim_data, status):
    d = claim_data
    d.db.add(Attendance(meetup_id=d.meetup.id, user_id=d.member.id, status=status))
    await d.db.commit()
    with pytest.raises(HTTPException) as error:
        await claim(d)
    assert error.value.status_code == 409
    assert d.reservation.status == "pending"
    assert d.attendance.user_id == d.guest.id


@pytest.mark.asyncio
async def test_cancelled_attendance_is_replaced_and_missing_skill_is_filled(claim_data):
    d = claim_data
    d.member.self_assessed_skill = None
    d.db.add(
        Attendance(meetup_id=d.meetup.id, user_id=d.member.id, status="cancelled")
    )
    await d.db.commit()
    await claim(d)
    entries = (
        await d.db.scalars(select(Attendance).where(Attendance.user_id == d.member.id))
    ).all()
    assert len(entries) == 1
    assert entries[0].status == "confirmed"
    assert d.member.self_assessed_skill == 3


@pytest.mark.asyncio
async def test_claim_requires_auth_and_cannot_be_taken_by_host_or_another_member(
    claim_data,
):
    d = claim_data
    with pytest.raises(HTTPException) as error:
        req = SimpleNamespace(state=SimpleNamespace(user=None))
        await claim_plus_one("test-claim", req, d.db)  # pyright: ignore[reportArgumentType]
    assert error.value.status_code == 401
    with pytest.raises(HTTPException) as error:
        await claim(d, d.host)
    assert error.value.status_code == 409
    await claim(d)
    with pytest.raises(HTTPException) as error:
        await claim(d, d.host)
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_future_bookings_do_not_count_as_played_and_season_is_serialized(
    claim_data,
):
    d = claim_data
    now = datetime.now(UTC).replace(tzinfo=None)
    for offset, status in [(-2, "confirmed"), (1, "confirmed"), (-1, "waitlisted")]:
        meetup = Meetup(start_time=now + timedelta(days=offset), location="Stats")
        d.db.add(meetup)
        await d.db.flush()
        d.db.add(Attendance(meetup_id=meetup.id, user_id=d.member.id, status=status))
    await d.db.commit()
    stats = UserStats(**await get_user_statistics(d.db, d.member.id)).model_dump()
    assert stats["games_played"] == 1
    assert stats["season_games"] == (
        1 if (now - timedelta(days=2)).year == now.year else 0
    )
