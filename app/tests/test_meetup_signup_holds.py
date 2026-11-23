from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from py_vapid import Vapid
from sqlalchemy import select

from app.api.main import app
from app.core.config import settings
from app.core.database import Base, async_session, engine
from app.core.timeutil import utcnow
from app.models.meetup import Attendance, Meetup
from app.models.meetup_signup_hold import MeetupSignupHold
from app.models.job_queue import JobQueue
from app.models.user import User
from app.services.job_queue import run_due_jobs
from app.services.meetup_signup import HOLD_DURATION, signup_hold_token


@pytest.fixture
async def signup(monkeypatch, tmp_path):
    vapid = Vapid()
    vapid.generate_keys()
    key_path = tmp_path / "vapid-private.pem"
    vapid.save_key(str(key_path))
    monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY", str(key_path))
    monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY", "")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        meetup = Meetup(start_time=utcnow() + timedelta(days=1), location="Pitch", min_players=1, max_players=1)
        users = [User(pocket_id_sub=f"p{i}-uuid") for i in range(1, 4)]
        db.add_all([meetup, *users])
        await db.commit()
        meetup_id = meetup.id
        tokens = [signup_hold_token(meetup, user.id) for user in users]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, meetup_id, tokens


def auth(player: int) -> dict[str, str]:
    return {"Authorization": f"Bearer p{player}"}


async def test_invited_player_claims_original_place_after_signin(signup):
    client, meetup_id, (token, second_token, _) = signup
    hold_url = "/meetups/signup-hold"
    join_url = f"/meetups/{meetup_id}/join"
    assert (await client.post(hold_url, json={"token": "invalid"})).status_code == 404
    result = (await client.post(hold_url, json={"token": token})).json()
    assert result["reserved"] is True
    assert (await client.post(hold_url, json={"token": token})).json() == result
    async with async_session() as db:
        hold = (await db.scalars(select(MeetupSignupHold))).one()
        assert hold.expires_at - hold.started_at == HOLD_DURATION
        assert (await db.scalars(select(JobQueue))).one().run_at == hold.expires_at
        assert not (await db.scalars(select(Attendance))).all()
        original_tap = hold.started_at

    second_hold = (await client.post(hold_url, json={"token": second_token})).json()
    assert second_hold["hold_id"] != result["hold_id"]
    assert (await client.post(join_url, params={"reservation_id": result["hold_id"]}, headers=auth(2))).status_code == 409
    assert (await client.post(join_url, headers=auth(2))).json()["status"] == "waitlisted"
    assert (await client.post(join_url, params={"reservation_id": result["hold_id"]}, headers=auth(1))).json()["status"] == "confirmed"
    async with async_session() as db:
        confirmed = (await db.scalars(select(Attendance).where(Attendance.status == "confirmed"))).one()
        assert confirmed.joined_at == original_tap


async def test_expiry_preserves_fifo_and_cannot_restart_hold(signup):
    client, meetup_id, (token, *_) = signup
    hold_url = "/meetups/signup-hold"
    join_url = f"/meetups/{meetup_id}/join"
    result = (await client.post(hold_url, json={"token": token})).json()
    assert result["reserved"] is True
    assert (await client.post(join_url, headers=auth(2))).json()["status"] == "waitlisted"
    async with async_session() as db:
        hold = (await db.scalars(select(MeetupSignupHold))).one()
        job = (await db.scalars(select(JobQueue))).one()
        hold.expires_at = job.run_at = utcnow() - timedelta(seconds=1)
        await db.commit()

    # Even before the expiry job runs, a later signup can't pass the waitlist.
    assert (await client.post(join_url, headers=auth(3))).json()["status"] == "waitlisted"
    assert (await client.post(hold_url, json={"token": token})).json()["reserved"] is False
    assert (await client.post(join_url, params={"reservation_id": result["hold_id"]}, headers=auth(1))).status_code == 409
    assert await run_due_jobs() == 1
    async with async_session() as db:
        status = dict((await db.execute(select(User.pocket_id_sub, Attendance.status).join(Attendance))).all())
        assert status == {"p2-uuid": "confirmed", "p3-uuid": "waitlisted"}
    assert (await client.post(join_url, headers=auth(1))).json()["status"] == "waitlisted"


async def test_hold_keeps_position_when_meetup_is_full(signup):
    client, meetup_id, (_, token, _) = signup
    meetup_url = f"/meetups/{meetup_id}"
    assert (await client.post(f"{meetup_url}/join", headers=auth(1))).json()["status"] == "confirmed"
    hold = (await client.post("/meetups/signup-hold", json={"token": token})).json()
    assert hold["reserved"] is True
    assert (await client.post(f"{meetup_url}/join", headers=auth(3))).json()["status"] == "waitlisted"
    detail = (await client.get(meetup_url, headers=auth(3))).json()
    assert detail["my_waitlist_position"] == 2

    assert (await client.delete(f"{meetup_url}/leave", headers=auth(1))).status_code == 200
    detail = (await client.get(meetup_url, headers=auth(3))).json()
    assert detail["my_attendance"] == "waitlisted"
    assert detail["my_waitlist_position"] == 1
    response = await client.post(
        f"{meetup_url}/join", params={"reservation_id": hold["hold_id"]}, headers=auth(2),
    )
    assert response.json()["status"] == "confirmed"
