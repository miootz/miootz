"""Weather Hero award: admin one-button grant, waitlist redemption that
promotes the holder and demotes the most-recently-joined confirmed player."""

from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.award import WeatherHeroAward
from app.models.meetup import Attendance
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def make_meetup(ac: AsyncClient, max_players: int) -> int:
    start = datetime.now(UTC).replace(tzinfo=None)
    r = await ac.post(
        "/meetups/",
        json={
            "start_time": start.isoformat(),
            "location": "Pitch",
            "min_players": 1,
            "max_players": max_players,
            "max_teams": 2,
            "send_push_notifications": False,
        },
        headers=hdr("admin"),
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def user_id(ac, token: str) -> int:
    async with AsyncSession(engine) as db:
        return (
            await db.execute(
                select(User).where(User.pocket_id_sub == f"{token}-uuid")
            )
        ).scalar_one().id


async def attendance_status(ac, sid: int, uid: int) -> str:
    async with AsyncSession(engine) as db:
        return (
            (
                await db.execute(
                    select(Attendance).where(
                        Attendance.meetup_id == sid,
                        Attendance.user_id == uid,
                    )
                )
            )
            .scalar_one()
            .status
        )


@pytest.mark.asyncio
async def test_grant_is_idempotent_and_covers_confirmed_only():
    async with await client() as ac:
        # Max 4, five join: p1..p4 confirmed, p5 waitlisted.
        sid = await make_meetup(ac, 4)
        for token in ("p1", "p2", "p3", "p4", "p5"):
            rj = await ac.post(f"/meetups/{sid}/join", headers=hdr(token))
            assert rj.status_code == 200, rj.text

        r = await ac.post(f"/meetups/{sid}/awards/weather-hero", headers=hdr("admin"))
        assert r.status_code == 200, r.text
        assert r.json()["granted"] == 4  # waitlisted players don't earn it

        # Re-grant reaches only new confirmed attendees (none).
        r = await ac.post(f"/meetups/{sid}/awards/weather-hero", headers=hdr("admin"))
        assert r.status_code == 200
        assert r.json()["granted"] == 0

        p5 = await user_id(ac, "p5")
        async with AsyncSession(engine) as db:
            awards_p5 = (
                (
                    await db.execute(
                        select(WeatherHeroAward).where(
                            WeatherHeroAward.user_id == p5
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert awards_p5 == []


@pytest.mark.asyncio
async def test_redeem_promotes_and_demotes_last_joined():
    async with await client() as ac:
        # Max 5: p1..p5 confirmed, p6 waitlisted. Grant. p5 is moved to the
        # waitlist; auto-promote fills the spot with p6; p5 redeems → p6
        # (last joined) is demoted.
        sid = await make_meetup(ac, 5)
        for token in ("p1", "p2", "p3", "p4", "p5", "p6"):
            rj = await ac.post(f"/meetups/{sid}/join", headers=hdr(token))
            assert rj.status_code == 200, rj.text
        await ac.post(f"/meetups/{sid}/awards/weather-hero", headers=hdr("admin"))

        p5 = await user_id(ac, "p5")
        p6 = await user_id(ac, "p6")

        r = await ac.post(
            f"/meetups/{sid}/admin/move?user_id={p5}&new_status=waitlisted",
            headers=hdr("admin"),
        )
        assert r.status_code == 200, r.text
        assert await attendance_status(ac, sid, p6) == "confirmed"
        assert await attendance_status(ac, sid, p5) == "waitlisted"

        r = await ac.post(
            f"/meetups/{sid}/awards/weather-hero/redeem", headers=hdr("p5")
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "confirmed"
        assert body["demoted_user_id"] == p6

        assert await attendance_status(ac, sid, p5) == "confirmed"
        assert await attendance_status(ac, sid, p6) == "waitlisted"

        # The award is consumed; a second redemption finds p5 confirmed.
        async with AsyncSession(engine) as db:
            award = (
                await db.execute(
                    select(WeatherHeroAward).where(
                        WeatherHeroAward.user_id == p5
                    )
                )
            ).scalar_one()
        assert award.used_meetup_id == sid
        assert award.used_at is not None

        r2 = await ac.post(
            f"/meetups/{sid}/awards/weather-hero/redeem", headers=hdr("p5")
        )
        assert r2.status_code == 409, r2.text


@pytest.mark.asyncio
async def test_redeem_requires_waitlist_and_unused_award():
    async with await client() as ac:
        # Max 4, five join: p5 waitlisted, no award granted to them.
        sid = await make_meetup(ac, 4)
        for token in ("p1", "p2", "p3", "p4", "p5"):
            await ac.post(f"/meetups/{sid}/join", headers=hdr(token))

        # No award granted at all.
        r = await ac.post(
            f"/meetups/{sid}/awards/weather-hero/redeem", headers=hdr("p5")
        )
        assert r.status_code == 409, r.text

        await ac.post(f"/meetups/{sid}/awards/weather-hero", headers=hdr("admin"))

        # A confirmed player cannot redeem.
        r = await ac.post(
            f"/meetups/{sid}/awards/weather-hero/redeem", headers=hdr("p1")
        )
        assert r.status_code == 409, r.text

        # The waitlisted p5 holds no award (they were waitlisted at grant).
        r = await ac.post(
            f"/meetups/{sid}/awards/weather-hero/redeem", headers=hdr("p5")
        )
        assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_redeem_with_space_does_not_demote():
    async with await client() as ac:
        # Broadcast mode: opening a spot only notifies, nobody is
        # auto-promoted — so after p5 is moved to the waitlist, space
        # remains and the redemption demotes no one.
        start = datetime.now(UTC).replace(tzinfo=None)
        r = await ac.post(
            "/meetups/",
            json={
                "start_time": start.isoformat(),
                "location": "Pitch",
                "min_players": 1,
                "max_players": 6,
                "max_teams": 2,
                "waitlist_mode": "broadcast",
                "send_push_notifications": False,
            },
            headers=hdr("admin"),
        )
        assert r.status_code == 201, r.text
        sid = r.json()["id"]
        for token in ("p1", "p2", "p3", "p4", "p5", "p6"):
            rj = await ac.post(f"/meetups/{sid}/join", headers=hdr(token))
            assert rj.status_code == 200, rj.text
        await ac.post(f"/meetups/{sid}/awards/weather-hero", headers=hdr("admin"))

        p4 = await user_id(ac, "p4")
        p5 = await user_id(ac, "p5")
        r = await ac.post(
            f"/meetups/{sid}/admin/move?user_id={p5}&new_status=waitlisted",
            headers=hdr("admin"),
        )
        assert r.status_code == 200, r.text
        assert await attendance_status(ac, sid, p5) == "waitlisted"

        r = await ac.post(
            f"/meetups/{sid}/awards/weather-hero/redeem", headers=hdr("p5")
        )
        assert r.status_code == 200, r.text
        assert r.json()["demoted_user_id"] is None
        assert await attendance_status(ac, sid, p5) == "confirmed"
        assert await attendance_status(ac, sid, p4) == "confirmed"


@pytest.mark.asyncio
async def test_detail_exposes_award_state():
    async with await client() as ac:
        # Max 4, five join: p5 waitlisted.
        sid = await make_meetup(ac, 4)
        for token in ("p1", "p2", "p3", "p4", "p5"):
            await ac.post(f"/meetups/{sid}/join", headers=hdr(token))

        r = await ac.get(f"/meetups/{sid}", headers=hdr("p5"))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["weather_hero_granted"] is False
        assert body["my_weather_hero_unused"] == 0

        await ac.post(f"/meetups/{sid}/awards/weather-hero", headers=hdr("admin"))
        r = await ac.get(f"/meetups/{sid}", headers=hdr("p5"))
        body = r.json()
        assert body["weather_hero_granted"] is True
        # p5 is waitlisted → no award was granted to them.
        assert body["my_weather_hero_unused"] == 0

        # A confirmed holder sees their count.
        r = await ac.get(f"/meetups/{sid}", headers=hdr("p1"))
        assert r.json()["my_weather_hero_unused"] == 1
