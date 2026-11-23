import pytest
from datetime import datetime, timedelta, UTC
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select

from app.api.main import app
from app.core.database import Base, async_session, engine
from app.models.match import MeetupMatch
from app.models.meetup import Attendance, Meetup
from app.models.rating import Rating
from app.models.user import User
from app.demo_data import seed_demo
from app.services.skill_service import blend_skill, update_user_calculated_skill
from app.api import rankings, users_stats
from app.services import skill_service
from app.services.rating_settings import RatingSettings
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
        rater1 = User(pocket_id_sub="p1-uuid", sso_display_name="r1")
        rater2 = User(pocket_id_sub="p2-uuid", sso_display_name="r2")
        db.add_all([auth_user, player, rater1, rater2])
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
        for uid in (rater1.id, rater2.id, player.id, auth_user.id):
            db.add(Attendance(meetup_id=s1id, user_id=uid))
        await db.commit()

        player_id = player.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        settings = await ac.get(
            "/rating-settings", headers={"Authorization": "Bearer tester"}
        )
        assert settings.json()["peer_rating_mode"] == "teammates-only"
        changed = await ac.patch(
            "/rating-settings",
            headers={"Authorization": "Bearer admin"},
            json={"computed_scores": True, "peer_rating_mode": "everyone"},
        )
        assert changed.status_code == 200, changed.text
        for token, expected in (("tester", 3.0), ("p1", 3.0), ("p2", 3.6)):
            resp = await ac.post(
                "/ratings/",
                headers={"Authorization": f"Bearer {token}"},
                json={"meetup_id": s1id, "ratee_id": player_id, "score": 5},
            )
            assert resp.status_code == 200, resp.text
            async with async_session() as db:
                assert (await db.get(User, player_id)).calculated_skill == expected

        for mode, expected in (("teammates-only", 3.0), ("everyone", 3.6)):
            changed = await ac.patch(
                "/rating-settings",
                headers={"Authorization": "Bearer admin"},
                json={"computed_scores": True, "peer_rating_mode": mode},
            )
            assert changed.status_code == 200, changed.text
            async with async_session() as db:
                assert (await db.get(User, player_id)).calculated_skill == expected

        cleared = await ac.post(
            "/ratings/",
            headers={"Authorization": "Bearer p2"},
            json={"meetup_id": s1id, "ratee_id": player_id, "score": 0},
        )
        assert cleared.json() is None

    async with async_session() as db:
        player_row = await db.get(User, player_id)
        assert player_row is not None
        # Dropping below three reviewers restores the baseline.
        assert player_row.calculated_skill == 3.0
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


async def test_peer_decay_counts_meetups_and_weights_averages_not_vote_counts():
    now = datetime.now(UTC)
    async with async_session() as db:
        db.add_all(User(id=i, pocket_id_sub=f"peer-{i}") for i in range(1, 6))
        db.add_all(
            Meetup(
                id=mid,
                start_time=now - timedelta(days=age),
                location="Test pitch",
                max_players=10,
                skipped=skipped,
            )
            for mid, age, skipped in ((1, 50, False), (2, 17, False), (3, 8, True), (4, 2, False))
        )
        await db.flush()
        db.add_all(
            Rating(meetup_id=mid, rater_id=rater, ratee_id=1, score=score)
            for mid, votes in ((1, (5, 5, 5, 5)), (2, (1, 1)), (3, (1, 1, 1)), (4, (1, 2, 3)))
            for rater, score in enumerate(votes, start=2)
        )
        await db.flush()
        positions = await skill_service._peer_meetup_positions(db)
        assert positions == {4: 0, 2: 1, 1: 2}
        peer, adjustment = await skill_service._get_weighted_peer_average(db, 1, None, positions)
        assert adjustment is None
        assert peer == pytest.approx((2 + 0.5 * 5) / 1.5)

        vote = await db.scalar(select(Rating).where(Rating.meetup_id == 4, Rating.rater_id == 2))
        vote.score, vote.review = 3, "expected"
        await db.flush()
        peer, adjustment = await skill_service._get_weighted_peer_average(
            db, 1, None, positions, anchor=4.5,
        )
        assert peer is None
        assert adjustment == pytest.approx(((4.5 + 2 + 3) / 3 + 0.5 * 5) / 1.5 - 4.5)


@pytest.mark.parametrize(
    ("mode", "expected"),
    [
        ("everyone", [3.6, 4.1, None, 2.0, 3.7]),
        ("teammates-only", [3.6, 4.1, None, 2.0, None]),
        ("off", [3.0, 4.0, None, 2.0, None]),
    ],
)
async def test_global_refresh_batches_reads_and_matches_individual_updates(mode, expected):
    now = datetime.now(UTC)
    async with async_session() as db:
        players = [
            User(id=1, seed_skill=3.0),
            User(id=2, seed_skill=4.0),
            User(id=3, calculated_skill=4.0),
            User(id=4, seed_skill=2.0),
            User(id=5),
        ]
        db.add_all(players + [User(id=i) for i in range(6, 12)])
        db.add(RatingSettings(id=1, computed_scores=True, peer_rating_mode=mode))
        db.add_all(
            Meetup(
                id=mid, start_time=now - timedelta(days=age),
                location="Pitch", skipped=skipped,
            )
            for mid, age, skipped in (
                (1, 21, False), (2, 14, False), (3, 7, False),
                (4, 5, True), (5, -3, False),
            )
        )
        await db.flush()
        db.add(
            MeetupMatch(
                meetup_id=3, match_number=1, status="completed",
                team_a_users="[1, 6, 7, 8]", team_b_users="[2, 9, 10, 11]",
                team_a_name="A", team_b_name="B",
            )
        )
        db.add_all([
            Attendance(meetup_id=4, user_id=1, status="confirmed"),
            Attendance(meetup_id=2, user_id=2, status="confirmed"),
            Attendance(meetup_id=3, user_id=2, status="waitlisted"),
        ])
        db.add_all(
            Rating(
                meetup_id=3, rater_id=rater, ratee_id=player,
                score=score, review=review,
            )
            for player, raters, score, review in (
                (1, (6, 7, 8), 5, None),
                (2, (9, 10, 11), 4, "excellent"),
                (3, (6, 7), 5, None),
                (5, (6, 7, 8), 4, None),
            )
            for rater in raters
        )
        db.add_all([
            Rating(meetup_id=3, rater_id=1, ratee_id=1, score=1),
            Rating(meetup_id=3, rater_id=9, ratee_id=1, score=0),
            *(
                Rating(meetup_id=mid, rater_id=rater, ratee_id=1, score=1)
                for mid in (4, 5)
                for rater in (6, 7, 8)
            ),
        ])
        await db.commit()

        statements = []

        def capture_statement(
            _conn, _cursor, statement, _parameters, _context, _executemany
        ):
            statements.append(statement.lower().lstrip())

        event.listen(engine.sync_engine, "before_cursor_execute", capture_statement)
        try:
            await skill_service.refresh_player_skills(db)
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", capture_statement)

        assert [player.calculated_skill for player in players] == expected
        assert sum(s.startswith("select ratings.id,") for s in statements) == (mode != "off")
        assert sum(s.startswith("select attendance.user_id,") for s in statements) == (
            mode != "off"
        )

        for player, skill in zip(players, expected, strict=True):
            await update_user_calculated_skill(db, player.id, commit=False)
            assert player.calculated_skill == skill

        await db.rollback()
        assert (await db.get(User, 1)).calculated_skill is None
        assert (await db.get(User, 3)).calculated_skill == 4.0


def test_blend_keeps_missing_attribute_weight_on_baseline():
    attributes = {"sho": 3.4, "pas": 2.7, "def": 3.4, "pac": 4.0, "dri": None}
    assert blend_skill(3.4, 4.2, attributes) == 3.6
    assert blend_skill(3.4, 4.2, attributes, miss_streak=3) == 3.4
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
        assert rankings.json()["total"] == 20
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
        assert profile.json()["base_rating"] == 4.2
        assert attrs["pac"] == 2.5
        assert attrs["dri"] == 4.0

        history = await client.get("/meetups/2/rankings", headers=headers)
        assert history.status_code == 200, history.text
        assert history.json()["night"]["kpis"]["matches"] == 6

        update = await client.patch(
            "/users/1", headers=headers, json={"seed_skill": 4.5, "pac": 3.5, "dri": 4}
        )
        assert update.status_code == 200, update.text
        profile = await client.get("/users/me/stats", headers=headers)
        assert profile.json()["attributes"]["pac"] == 3.5
        assert profile.json()["attributes"]["dri"] == 4
        automatic = profile.json()

        overrides = {"sho_override": 1, "pas_override": 1, "def_override": 1}
        invalid = await client.patch(
            "/users/1", headers=headers, json={"sho_override": 0}
        )
        assert invalid.status_code == 422
        update = await client.patch("/users/1", headers=headers, json=overrides)
        assert update.status_code == 200, update.text
        overridden = (await client.get("/users/me/stats", headers=headers)).json()
        for key in ("sho", "pas", "def"):
            assert overridden["attributes"][key] == {
                **automatic["attributes"][key],
                "score": 1,
                "overridden": True,
            }
        assert overridden["adjusted_rating"] < automatic["adjusted_rating"]

        rankings = await client.get("/rankings/attributes?year=all", headers=headers)
        row = next(row for row in rankings.json()["rows"] if row["user"]["id"] == 1)
        assert (row["sho"], row["pas"], row["def"]) == (1, 1, 1)

        cleared = await client.patch(
            "/users/1", headers=headers, json=dict.fromkeys(overrides)
        )
        assert cleared.status_code == 200, cleared.text
        profile = (await client.get("/users/me/stats", headers=headers)).json()
        assert profile["attributes"] == automatic["attributes"]
        assert profile["adjusted_rating"] == automatic["adjusted_rating"]

    async with async_session() as db:
        admin = await db.get(User, 1)
        assert admin.seed_skill == 4.5
        assert admin.calculated_skill is not None


def test_draft_skill_uses_three_for_unrated_players_and_preserves_zero():
    assert draft_skill(None) == 3.0
    assert draft_skill(0.0) == 0.0


async def test_disabling_computation_uses_base_everywhere_without_loading_attributes(
    monkeypatch,
):
    async with async_session() as db:
        await seed_demo(
            db, anchor=datetime.now(UTC).replace(tzinfo=None), scenario="squad"
        )
        admin = await db.get(User, 1)
        admin.pocket_id_sub = "admin-uuid"
        await db.commit()

    async def unavailable(*args, **kwargs):
        pytest.fail("Base Rating mode must skip attribute calculation")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        admin = {"Authorization": "Bearer admin"}
        member = {"Authorization": "Bearer user"}
        settings = {"computed_scores": False, "peer_rating_mode": "off"}
        assert (
            await client.patch("/rating-settings", headers=member, json=settings)
        ).status_code == 403

        with monkeypatch.context() as patches:
            patches.setattr(rankings.rankings_service, "load_cached_attributes", unavailable)
            patches.setattr(users_stats, "load_cached_attributes", unavailable)
            patches.setattr(skill_service, "load_player_attributes", unavailable)
            response = await client.patch(
                "/rating-settings", headers=admin, json=settings
            )
            assert response.status_code == 200, response.text
            assert (
                await client.get("/rating-settings", headers=member)
            ).json() == settings
            edit = await client.patch(
                "/users/1", headers=admin, json={"seed_skill": 4.7}
            )
            assert edit.status_code == 200
            profile = (await client.get("/users/me/stats", headers=admin)).json()
            assert (
                profile["base_rating"],
                profile["adjusted_rating"],
                profile["skill_level"],
            ) == (4.7, None, 4.7)
            assert profile["attributes"] is None
            assert (await client.get("/me", headers=admin)).json()["user"][
                "calculated_skill"
            ] == 4.7
            ratings = (
                await client.get(
                    "/rankings/attributes?year=all&sort=pas", headers=admin
                )
            ).json()
            assert ratings["computed_scores"] is False
            row = next(row for row in ratings["rows"] if row["user"]["id"] == 1)
            assert row["rating"] == 4.7
            assert row["pas"] is None

        reactivated = await client.patch(
            "/rating-settings",
            headers=admin,
            json={**settings, "computed_scores": True},
        )
        assert reactivated.status_code == 200, reactivated.text
        profile = (await client.get("/users/me/stats", headers=admin)).json()
        attrs = {
            key: profile["attributes"][key]["score"] for key in ("sho", "pas", "def")
        }
        assert profile["adjusted_rating"] == blend_skill(4.7, None, attrs)
        assert profile["skill_level"] == profile["adjusted_rating"]
