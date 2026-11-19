import pytest
from datetime import datetime, timedelta, UTC
from httpx import ASGITransport, AsyncClient

from app.api.main import app
from app.core.database import Base, async_session, engine
from app.models.meetup import Attendance, Meetup
from app.models.user import User
from app.demo_data import seed_demo
from app.services.skill_service import blend_skill, update_user_calculated_skill
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
            pocket_id_sub="test-p1",
            sso_display_name="p1",
            seed_skill=3.0,
            calculated_skill=3.0,
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
        # The peer vote carries 55 parts and the original seed carries 25.
        assert player_row.calculated_skill == 4.4
        assert player_row.seed_skill == 3.0


@pytest.mark.asyncio
async def test_seed_skill_persists_without_peer_ratings():
    async with async_session() as db:
        player = User(
            pocket_id_sub="test-p1",
            sso_display_name="p1",
            seed_skill=3.0,
            calculated_skill=3.0,
        )
        db.add(player)
        await db.commit()
        await db.refresh(player)

        await update_user_calculated_skill(db, user_id=player.id)

        player_row = await db.get(User, player.id)
        assert player_row is not None
        # No peer ratings: the admin seed is left untouched.
        assert player_row.calculated_skill == 3.0


def test_blend_keeps_missing_attribute_weight_on_baseline():
    attributes = {"sho": 3.4, "pas": 2.7, "def": 3.4, "pac": 4.0, "dri": None}
    assert blend_skill(3.4, 4.2, attributes) == 3.8
    assert blend_skill(3.4, 4.2, attributes, miss_streak=3) == 3.6
    assert blend_skill(3.4, None, attributes, miss_streak=3) == 3.4
    assert blend_skill(0.0, None, {}) == 0.0
    assert blend_skill(None, None, attributes) is None


async def test_attributes_in_rankings_profile_and_admin_edit():
    async with async_session() as db:
        await seed_demo(
            db, anchor=datetime.now(UTC).replace(tzinfo=None), scenario="squad"
        )
        admin = await db.get(User, 1)
        admin.pocket_id_sub = "admin-uuid"
        await db.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        headers = {"Authorization": "Bearer admin"}
        rankings = await client.get(
            "/rankings/attributes?year=all&sort=pas&per_page=3", headers=headers
        )
        assert rankings.status_code == 200, rankings.text
        assert rankings.json()["total"] == 15
        rows = rankings.json()["rows"]
        assert len(rows) == 3
        assert [row["pas"] for row in rows] == sorted(
            [row["pas"] for row in rows], reverse=True
        )

        profile = await client.get("/users/me/stats", headers=headers)
        assert profile.status_code == 200, profile.text
        attrs = profile.json()["attributes"]
        assert attrs["sho"]["sample"] == 12
        assert attrs["def"]["meetups"] == 3
        assert attrs["pac"] is None

        history = await client.get("/meetups/2/rankings", headers=headers)
        assert history.status_code == 200, history.text
        night = history.json()["night"]
        assert night["assists_credited"] == night["open_play_goals"] > 0

        update = await client.patch(
            "/users/1", headers=headers, json={"seed_skill": 4.5, "pac": 3.5, "dri": 4}
        )
        assert update.status_code == 200, update.text
        profile = await client.get("/users/me/stats", headers=headers)
        assert profile.json()["attributes"]["pac"] == 3.5
        assert profile.json()["attributes"]["dri"] == 4

    async with async_session() as db:
        admin = await db.get(User, 1)
        assert admin.seed_skill == 4.5
        assert admin.calculated_skill is not None


def test_draft_skill_uses_three_for_unrated_players_and_preserves_zero():
    assert draft_skill(None) == 3.0
    assert draft_skill(0.0) == 0.0
