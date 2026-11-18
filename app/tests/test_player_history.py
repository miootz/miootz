"""Admin players list (search + pagination) and player history endpoint."""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import engine


@pytest.mark.asyncio
async def test_admin_list_players_paginated():
    """GET /users honors limit/offset and returns total."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        for name in ["Alpha One", "Beta Two", "Gamma Three"]:
            first, last = name.split(maxsplit=1)
            r = await ac.post(
                "/users",
                json={"first_name": first, "last_name": last, "calculated_skill": 3},
                headers={"Authorization": "Bearer admintoken"},
            )
            assert r.status_code == 200

        r = await ac.get(
            "/users?limit=2&offset=0",
            headers={"Authorization": "Bearer admintoken"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] >= 3
        assert len(data["items"]) == 2

        r2 = await ac.get(
            "/users?limit=2&offset=2",
            headers={"Authorization": "Bearer admintoken"},
        )
        assert r2.status_code == 200
        first_ids = {u["id"] for u in data["items"]}
        second_ids = {u["id"] for u in r2.json()["items"]}
        assert not (first_ids & second_ids)


@pytest.mark.asyncio
async def test_admin_list_players_search():
    """GET /users?q filters by name/username/sub."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/users?q=alpha",
            headers={"Authorization": "Bearer admintoken"},
        )
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert items, "search should find the Alpha One user"
        assert all(
            "alpha" in (u["display_name"] or "").lower()
            for u in items
        )


@pytest.mark.asyncio
async def test_admin_list_players_requires_admin():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/users",
            headers={"Authorization": "Bearer usertoken"},
        )
        assert r.status_code == 403


@pytest.mark.asyncio
async def test_admin_player_history():
    """GET /users/{id}/history returns profile + stats + paginated history."""
    from datetime import timedelta

    from app.core.timeutil import utcnow
    from app.models.meetup import Attendance, MatchScore, Meetup
    from app.models.rating import Rating

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        create_r = await ac.post(
            "/users",
            json={"first_name": "History", "last_name": "Player", "calculated_skill": 3},
            headers={"Authorization": "Bearer admintoken"},
        )
        assert create_r.status_code == 200
        user_id = create_r.json()["id"]

        async with AsyncSession(engine) as db:
            m1 = Meetup(
                start_time=utcnow() - timedelta(days=14), location="Hall 1"
            )
            m2 = Meetup(
                start_time=utcnow() - timedelta(days=7), location="Hall 2"
            )
            db.add_all([m1, m2])
            await db.commit()
            await db.refresh(m1)
            await db.refresh(m2)
            m1_id, m2_id = m1.id, m2.id
            db.add_all(
                [
                    Attendance(
                        meetup_id=m1_id, user_id=user_id, status="confirmed"
                    ),
                    Attendance(
                        meetup_id=m2_id, user_id=user_id, status="cancelled"
                    ),
                    MatchScore(
                        meetup_id=m1_id, player_id=user_id, score=4, type="team"
                    ),
                    MatchScore(
                        meetup_id=m1_id,
                        player_id=user_id,
                        score=5,
                        type="individual",
                    ),
                    Rating(
                        meetup_id=m1_id,
                        rater_id=1,
                        ratee_id=user_id,
                        score=4,
                    ),
                ]
            )
            await db.commit()

        r = await ac.get(
            f"/users/{user_id}/history",
            headers={"Authorization": "Bearer admintoken"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["id"] == user_id
        assert set(data["stats"]) == {
            "games_played",
            "season_games",
            "average_rating",
            "total_ratings",
            "skill_level",
            "goals",
            "assists",
            "clean_sheets",
            "goals_conceded",
            "wins",
            "matches",
            "win_rate",
            "season_goals",
            "season_assists",
            "season_clean_sheets",
            "season_goals_conceded",
            "season_wins",
            "season_losses",
            "season_matches",
            "season_win_rate",
            "season_goal_assists_per_match",
            "season_penalties_taken",
            "season_penalties_scored",
            "season_penalty_conversion_rate",
            "weather_hero_unused",
        }
        assert data["history"]["total"] == 2
        items = data["history"]["items"]
        assert len(items) == 2
        # Newest first
        assert items[0]["meetup_id"] == m2_id
        assert items[0]["status"] == "cancelled"
        attended = items[1]
        assert attended["score_team"] == 4
        assert attended["score_individual"] == 5
        assert attended["rating_avg"] == 4.0
        assert attended["location"] == "Hall 1"
        # Per-meetup metrics present (no matches seeded → all zeros)
        assert set(attended["metrics"]) == {
            "attendances",
            "goals",
            "assists",
            "clean_sheets",
            "goals_conceded",
            "wins",
            "matches",
            "win_rate",
        }
        assert attended["metrics"]["goals"] == 0

        # Pagination: limit=1 returns one row, total unchanged
        r2 = await ac.get(
            f"/users/{user_id}/history?limit=1&offset=1",
            headers={"Authorization": "Bearer admintoken"},
        )
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["history"]["total"] == 2
        assert len(d2["history"]["items"]) == 1
        assert d2["history"]["items"][0]["meetup_id"] == m1_id


@pytest.mark.asyncio
async def test_admin_player_history_404():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/users/9999/history",
            headers={"Authorization": "Bearer admintoken"},
        )
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_player_history_self_access():
    """A non-admin member can view their own history, not someone else's."""
    from sqlalchemy import select

    from app.models.user import User

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # JIT-provision the member via any authenticated call.
        assert (await ac.get("/rankings", headers={"Authorization": "Bearer user"})).status_code == 200
        async with AsyncSession(engine) as db:
            me = (
                await db.execute(select(User).where(User.pocket_id_sub == "user-uuid"))
            ).scalar_one()
            other_r = await ac.post(
                "/users",
                json={"first_name": "Other", "last_name": "Player", "calculated_skill": 3},
                headers={"Authorization": "Bearer admintoken"},
            )
            other_id = other_r.json()["id"]

        # Self → 200, rows carry metrics.
        r = await ac.get(f"/users/{me.id}/history", headers={"Authorization": "Bearer user"})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["id"] == me.id
        for item in r.json()["history"]["items"]:
            assert "metrics" in item

        # Someone else → 403 for a member, 200 for an admin.
        r = await ac.get(f"/users/{other_id}/history", headers={"Authorization": "Bearer user"})
        assert r.status_code == 403
        r = await ac.get(f"/users/{other_id}/history", headers={"Authorization": "Bearer admintoken"})
        assert r.status_code == 200
