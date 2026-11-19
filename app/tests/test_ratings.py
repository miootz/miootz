import pytest
from datetime import datetime, timedelta, UTC
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.main import app
from app.core.database import Base, async_session, engine
from app.models.meetup import Attendance, Meetup
from app.models.rating import Rating
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.mark.asyncio
async def test_rating_constraint_unattended_meetup():
    async with async_session() as db:
        auth_user = User(pocket_id_sub="tester-uuid", sso_display_name="tester")
        db.add(auth_user)
        await db.commit()
        await db.refresh(auth_user)

        meetup = Meetup(
            start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=5),
            location="Test Park",
            max_players=10,
        )
        db.add(meetup)
        await db.commit()
        await db.refresh(meetup)

        meetup_id = meetup.id
        ratee_id = auth_user.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/ratings/",
            headers={"Authorization": "Bearer tester"},
            json={
                "meetup_id": meetup_id,
                "ratee_id": ratee_id,
                "score": 5,
            },
        )
    assert resp.status_code == 403
    assert (
        resp.json()["detail"] == "You can only rate players from meetups you attended"
    )


@pytest.mark.asyncio
async def test_anonymity_check():
    async with async_session() as db:
        auth_user = User(pocket_id_sub="tester-uuid", sso_display_name="tester")
        player = User(pocket_id_sub="test-player1", sso_display_name="player1")
        db.add_all([auth_user, player])
        await db.commit()
        await db.refresh(auth_user)
        await db.refresh(player)

        meetup = Meetup(
            start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=5),
            location="Test Park",
            max_players=10,
        )
        db.add(meetup)
        await db.commit()
        await db.refresh(meetup)

        sid = meetup.id
        pid = player.id
        db.add(Attendance(meetup_id=sid, user_id=auth_user.id))
        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post(
            "/ratings/",
            headers={"Authorization": "Bearer tester"},
            json={
                "meetup_id": sid,
                "ratee_id": pid,
                "score": 5,
            },
        )

        resp = await ac.get(
            f"/ratings/players/{pid}",
            headers={"Authorization": "Bearer tester"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "average_score" in data
    assert "total_ratings" in data
    assert "rater_id" not in data
    assert "username" not in data


@pytest.mark.asyncio
async def test_score_update_verification():
    """Two ratings in different meetups; no earlier meetup locks the first."""
    async with async_session() as db:
        auth_user = User(pocket_id_sub="tester-uuid", sso_display_name="tester")
        player1 = User(pocket_id_sub="test-p1", sso_display_name="p1")
        db.add_all([auth_user, player1])
        await db.commit()
        await db.refresh(auth_user)
        await db.refresh(player1)

        meetup = Meetup(
            start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=3),
            location="Test Park",
            max_players=10,
        )
        db.add(meetup)
        await db.commit()
        await db.refresh(meetup)

        for uid in (auth_user.id, player1.id):
            db.add(Attendance(meetup_id=meetup.id, user_id=uid))
        await db.commit()

        sid1 = meetup.id
        p1id = player1.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            "/ratings/",
            headers={"Authorization": "Bearer tester"},
            json={
                "meetup_id": sid1,
                "ratee_id": p1id,
                "score": 5,
            },
        )
        assert r1.status_code == 200

        async with async_session() as db:
            meetup2 = Meetup(
                start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2),
                location="Test Park 2",
                max_players=10,
            )
            db.add(meetup2)
            await db.commit()
            await db.refresh(meetup2)
            db.add(Attendance(meetup_id=meetup2.id, user_id=auth_user.id))
            db.add(Attendance(meetup_id=meetup2.id, user_id=player1.id))
            await db.commit()
            sid2 = meetup2.id

        r2 = await ac.post(
            "/ratings/",
            headers={"Authorization": "Bearer tester"},
            json={
                "meetup_id": sid2,
                "ratee_id": p1id,
                "score": 3,
            },
        )
        assert r2.status_code == 200

        resp = await ac.get(
            f"/ratings/players/{p1id}",
            headers={"Authorization": "Bearer tester"},
        )
    assert resp.status_code == 200
    assert resp.json()["average_score"] == 4.0


@pytest.mark.asyncio
async def test_rating_context_allows_non_attendee_read_only():
    async with async_session() as db:
        viewer = User(pocket_id_sub="viewer-uuid", sso_display_name="viewer")
        player = User(pocket_id_sub="test-player1", sso_display_name="player1")
        db.add_all([viewer, player])
        await db.commit()
        await db.refresh(viewer)
        await db.refresh(player)

        meetup = Meetup(
            start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=5),
            location="Pitch A",
            max_players=10,
        )
        db.add(meetup)
        await db.commit()
        await db.refresh(meetup)

        db.add(
            Attendance(
                meetup_id=meetup.id,
                user_id=player.id,
                status="confirmed",
            )
        )
        await db.commit()
        sid = meetup.id
        pid = player.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get(
            f"/ratings/meetups/{sid}/context",
            headers={"Authorization": "Bearer viewer"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["viewer_attended"] is False
    assert data["ratings_editable"] is False
    assert len(data["ratees"]) == 1
    assert data["ratees"][0]["user_id"] == pid
    assert data["ratees"][0]["my_score"] is None


@pytest.mark.asyncio
async def test_clear_rating_ignores_zero_and_recomputes_remaining_ratings():
    async with async_session() as db:
        tester = User(pocket_id_sub="tester-uuid", sso_display_name="Tester")
        other = User(pocket_id_sub="p1-uuid", sso_display_name="Other")
        legacy = User(pocket_id_sub="p2-uuid", sso_display_name="Legacy")
        player = User(
            pocket_id_sub="user-uuid", sso_display_name="Player",
            seed_skill=3.5, calculated_skill=3.5,
        )
        meetup = Meetup(
            start_time=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=5),
            location="Pitch A",
            max_players=10,
        )
        db.add_all([tester, other, legacy, player, meetup])
        await db.flush()
        for user in (tester, other, legacy, player):
            db.add(Attendance(meetup_id=meetup.id, user_id=user.id))
        db.add(
            Rating(meetup_id=meetup.id, rater_id=legacy.id, ratee_id=player.id, score=0)
        )
        await db.commit()
        meetup_id, player_id = meetup.id, player.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async def rate(token: str, score: int):
            return await ac.post(
                "/ratings/",
                headers={"Authorization": f"Bearer {token}"},
                json={"meetup_id": meetup_id, "ratee_id": player_id, "score": score},
            )

        # Skipping an unrated player creates no vote and leaves their seed alone.
        assert (await rate("tester", 0)).json() is None
        async with async_session() as db:
            assert (await db.get(User, player_id)).calculated_skill == 3.5
            assert len((await db.scalars(select(Rating))).all()) == 1

        context = await ac.get(
            f"/ratings/meetups/{meetup_id}/context",
            headers={"Authorization": "Bearer p2"},
        )
        player_context = next(
            r for r in context.json()["ratees"] if r["user_id"] == player_id
        )
        assert player_context["my_score"] is None
        summary = await ac.get(
            f"/meetups/{meetup_id}/history-summary",
            headers={"Authorization": "Bearer p2"},
        )
        assert summary.json()["my_rating_avg"] is None

        assert (await rate("tester", 5)).status_code == 200
        assert (await rate("p1", 1)).status_code == 200
        assert (await rate("tester", -1)).status_code == 422
        assert (await rate("tester", 6)).status_code == 422

        history = await ac.get(
            f"/users/{player_id}/history", headers={"Authorization": "Bearer user"}
        )
        assert history.json()["stats"]["average_rating"] == 3
        assert history.json()["stats"]["total_ratings"] == 2
        assert history.json()["history"]["items"][0]["rating_avg"] == 3
        async with async_session() as db:
            assert (await db.get(User, player_id)).calculated_skill == 3.2

        assert (await rate("tester", 0)).json() is None
        assert (await rate("tester", 0)).json() is None
        stats = await ac.get(
            f"/ratings/players/{player_id}", headers={"Authorization": "Bearer tester"}
        )
        assert stats.json() == {"average_score": 1, "total_ratings": 1}
        async with async_session() as db:
            assert (await db.get(User, player_id)).calculated_skill == 1.8

        # Clearing the last valid vote returns skill to the seed.
        assert (await rate("p1", 0)).json() is None
        async with async_session() as db:
            assert (await db.get(User, player_id)).calculated_skill == 3.5
            assert [r.score for r in (await db.scalars(select(Rating))).all()] == [0]
