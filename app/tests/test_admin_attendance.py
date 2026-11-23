import asyncio
import json
from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.models.award import WeatherHeroAward
from app.models.guest_plus_one import GuestPlusOne
from app.models.match import MatchPenalty, MatchSubstitution, MeetupMatch
from app.models.match_goal import MatchGoal
from app.models.meetup import Attendance, MatchScore, Meetup
from app.models.rating import Rating
from app.models.user import User
from app.services.rating_settings import RatingSettings


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSession(engine) as db:
        db.add_all(
            [
                User(
                    pocket_id_sub="admin-uuid", sso_display_name="Admin", is_admin=True
                ),
                User(pocket_id_sub="user-uuid", sso_display_name="User"),
                User(pocket_id_sub="p1-uuid", sso_display_name="Player one"),
                User(pocket_id_sub="p2-uuid", sso_display_name="Player two"),
                User(pocket_id_sub="p3-uuid", sso_display_name="Player three"),
                User(pocket_id_sub="p4-uuid", sso_display_name="Player four"),
            ]
        )
        db.add(
            Meetup(
                start_time=datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1),
                location="Pitch",
                min_players=1,
                max_players=2,
            )
        )
        await db.commit()


@pytest.mark.asyncio
async def test_admin_adds_attendance_and_rejects_existing_records():
    async with AsyncSession(engine) as db:
        users = {u.pocket_id_sub: u.id for u in (await db.scalars(select(User))).all()}
        meetup_id = await db.scalar(select(Meetup.id))
        db.add_all(
            [
                Attendance(
                    meetup_id=meetup_id, user_id=users["p1-uuid"], status="confirmed"
                ),
                Attendance(
                    meetup_id=meetup_id, user_id=users["p2-uuid"], status="waitlisted"
                ),
                Attendance(
                    meetup_id=meetup_id, user_id=users["p3-uuid"], status="cancelled"
                ),
            ]
        )
        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        url = f"/meetups/{meetup_id}/admin/attendance"
        for sub in ("p1-uuid", "p2-uuid", "p3-uuid"):
            response = await client.post(
                url,
                params={"user_id": users[sub]},
                headers={"Authorization": "Bearer admin"},
            )
            assert response.status_code == 409
        response = await client.post(
            url,
            params={"user_id": users["p4-uuid"]},
            headers={"Authorization": "Bearer user"},
        )
        assert response.status_code == 403
        response = await client.post(
            url,
            params={"user_id": users["p4-uuid"]},
            headers={"Authorization": "Bearer admin"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "confirmed"
        response = await client.post(
            url,
            params={"user_id": users["user-uuid"]},
            headers={"Authorization": "Bearer admin"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "waitlisted"
        response = await client.post(
            url,
            params={"user_id": users["p4-uuid"]},
            headers={"Authorization": "Bearer admin"},
        )
        assert response.status_code == 409

    async with AsyncSession(engine) as db:
        rows = (
            await db.scalars(
                select(Attendance).where(Attendance.meetup_id == meetup_id)
            )
        ).all()
        assert len(rows) == 5
        assert {row.user_id: row.status for row in rows}[
            users["p4-uuid"]
        ] == "confirmed"
        assert (await db.get(Meetup, meetup_id)).content_revision == 2


@pytest.mark.asyncio
async def test_member_join_and_admin_add_cannot_duplicate_attendance():
    async with AsyncSession(engine) as db:
        user_id = await db.scalar(
            select(User.id).where(User.pocket_id_sub == "user-uuid")
        )
        meetup_id = await db.scalar(select(Meetup.id))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        admin, member = await asyncio.gather(
            client.post(
                f"/meetups/{meetup_id}/admin/attendance",
                params={"user_id": user_id},
                headers={"Authorization": "Bearer admin"},
            ),
            client.post(
                f"/meetups/{meetup_id}/join", headers={"Authorization": "Bearer user"}
            ),
        )
        assert sorted([admin.status_code, member.status_code]) in (
            [200, 400],
            [200, 409],
        )

    async with AsyncSession(engine) as db:
        rows = (
            await db.scalars(
                select(Attendance).where(
                    Attendance.meetup_id == meetup_id, Attendance.user_id == user_id
                )
            )
        ).all()
        assert len(rows) == 1
        assert (await db.get(Meetup, meetup_id)).content_revision == 1


@pytest.mark.asyncio
async def test_admin_cancels_or_removes_an_attendance_entry():
    async with AsyncSession(engine) as db:
        users = {u.pocket_id_sub: u.id for u in await db.scalars(select(User))}
        meetup = await db.scalar(select(Meetup))
        meetup.max_players = 1
        meetup_id = meetup.id
        player, waiting = users["p1-uuid"], users["p2-uuid"]
        db.add_all([
            Attendance(meetup_id=meetup_id, user_id=player, status="confirmed"),
            Attendance(meetup_id=meetup_id, user_id=waiting, status="waitlisted"),
            MatchScore(meetup_id=meetup_id, player_id=waiting, score=1, type="goals"),
        ])
        await db.commit()

    admin = {"Authorization": "Bearer admin"}
    url = f"/meetups/{meetup_id}/admin/attendance/{waiting}"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            f"/meetups/{meetup_id}/admin/move",
            params={"user_id": player, "new_status": "cancelled"},
            headers=admin,
        )
        assert response.status_code == 200
        async with AsyncSession(engine) as db:
            rows = {row.user_id: row for row in await db.scalars(select(Attendance))}
            assert rows[player].status == "cancelled"
            assert rows[player].previous_status == "confirmed"
            assert rows[waiting].status == "confirmed"

        response = await client.delete(url, headers={"Authorization": "Bearer user"})
        assert response.status_code == 403
        response = await client.delete(url, headers=admin)
        assert response.json() == {"status": "deleted"}
        async with AsyncSession(engine) as db:
            rows = {row.user_id: row.status for row in await db.scalars(select(Attendance))}
            assert rows == {player: "cancelled"}
            assert await db.scalar(select(MatchScore.player_id)) == waiting
        response = await client.post(
            f"/meetups/{meetup_id}/admin/attendance", params={"user_id": waiting}, headers=admin
        )
        assert response.json() == {"status": "confirmed"}


@pytest.mark.asyncio
async def test_remove_historical_attendance_preserves_other_players_and_results():
    now = datetime.now(UTC).replace(tzinfo=None)
    async with AsyncSession(engine) as db:
        users = {u.pocket_id_sub: u for u in await db.scalars(select(User))}
        removed, teammate, opponent, fourth = (users[f"p{i}-uuid"] for i in range(1, 5))
        removed_id, teammate_id, opponent_id, fourth_id = (u.id for u in (removed, teammate, opponent, fourth))
        teammate.seed_skill = 3
        teammate.calculated_skill = 4.5
        meetup = await db.scalar(select(Meetup))
        meetup.start_time = now - timedelta(days=5)
        meetup.manual_teams_json = json.dumps([[removed_id, teammate_id], [opponent_id, fourth_id]])
        other = Meetup(start_time=now - timedelta(days=2), location="Other pitch")
        db.add(other)
        await db.flush()
        meetup_id, other_id = meetup.id, other.id
        match = MeetupMatch(
            meetup_id=meetup_id, match_number=1,
            team_a_users=json.dumps([removed_id, teammate_id]),
            team_b_users=json.dumps([opponent_id, fourth_id]),
            team_a_name="A", team_b_name="B", score_a=2, score_b=2,
            score_offset_a=0, score_offset_b=1, status="completed",
            completed_at=now - timedelta(days=5), penalty_winner="a",
            penalty_score_a=3, penalty_score_b=2,
        )
        other_match = MeetupMatch(
            meetup_id=other_id, match_number=1,
            team_a_users=json.dumps([removed_id]), team_b_users=json.dumps([teammate_id]),
            team_a_name="A", team_b_name="B", score_a=1, score_b=0,
            status="completed", completed_at=now - timedelta(days=2),
        )
        db.add_all([match, other_match])
        await db.flush()
        match_id, other_match_id = match.id, other_match.id
        db.add_all([
            Attendance(meetup_id=meetup_id, user_id=removed_id, status="confirmed"),
            Attendance(meetup_id=meetup_id, user_id=teammate_id, status="confirmed"),
            Attendance(meetup_id=meetup_id, user_id=opponent_id, status="waitlisted"),
            Attendance(meetup_id=other_id, user_id=removed_id, status="confirmed"),
            MatchSubstitution(
                meetup_id=meetup_id, match_id=match_id,
                old_team_a_users=json.dumps([removed_id, teammate_id]),
                old_team_b_users=json.dumps([opponent_id, fourth_id]),
                new_team_a_users=json.dumps([teammate_id]),
                new_team_b_users=json.dumps([removed_id, fourth_id]),
                recorded_by=removed_id, clock_secs=100,
            ),
            MatchGoal(match_id=match_id, team="a", scorer_id=removed_id, assist_id=teammate_id,
                      recorded_by=removed_id, clock_secs=10, clock_minute=1, intent_id="removed"),
            MatchGoal(match_id=match_id, team="a", scorer_id=teammate_id, assist_id=removed_id,
                      recorded_by=removed_id, clock_secs=20, clock_minute=1, intent_id="assist"),
            MatchGoal(match_id=match_id, team="b", scorer_id=opponent_id, goalkeeper_id=removed_id,
                      recorded_by=removed_id, clock_secs=30, clock_minute=1, intent_id="keeper"),
            MatchGoal(match_id=match_id, team="b", scorer_id=removed_id, recorded_by=removed_id,
                      clock_secs=40, clock_minute=1, intent_id="soft-deleted", deleted_at=now),
            MatchGoal(match_id=other_match_id, team="a", scorer_id=removed_id, recorded_by=removed_id,
                      clock_secs=10, clock_minute=1, intent_id="other-meetup"),
            MatchPenalty(match_id=match_id, team="a", scorer_id=removed_id, scored=True),
            MatchPenalty(match_id=match_id, team="b", scorer_id=teammate_id, scored=True),
            MatchPenalty(match_id=other_match_id, team="a", scorer_id=removed_id, scored=True),
            MatchScore(meetup_id=meetup_id, player_id=removed_id, score=2, type="goals"),
            MatchScore(meetup_id=meetup_id, player_id=teammate_id, score=1, type="goals"),
            MatchScore(meetup_id=other_id, player_id=removed_id, score=1, type="goals"),
            Rating(meetup_id=meetup_id, rater_id=removed_id, ratee_id=teammate_id, score=5),
            Rating(meetup_id=meetup_id, rater_id=opponent_id, ratee_id=teammate_id, score=5),
            Rating(meetup_id=meetup_id, rater_id=fourth_id, ratee_id=teammate_id, score=5),
            Rating(meetup_id=meetup_id, rater_id=teammate_id, ratee_id=removed_id, score=5),
            Rating(meetup_id=other_id, rater_id=removed_id, ratee_id=teammate_id, score=5),
            RatingSettings(id=1, computed_scores=True, peer_rating_mode="everyone"),
            GuestPlusOne(meetup_id=meetup_id, inviter_id=teammate_id, guest_user_id=removed_id,
                         first_name="Guest", last_name="One", skill=3, claim_token="remove-guest"),
            GuestPlusOne(meetup_id=meetup_id, inviter_id=removed_id, guest_user_id=opponent_id,
                         first_name="Other", last_name="Guest", skill=3, claim_token="keep-guest"),
            WeatherHeroAward(user_id=removed_id, granted_meetup_id=meetup_id),
            WeatherHeroAward(user_id=removed_id, granted_meetup_id=meetup_id,
                             used_meetup_id=other_id, used_at=now),
            WeatherHeroAward(user_id=teammate_id, granted_meetup_id=meetup_id),
        ])
        await db.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.delete(
            f"/meetups/{meetup_id}/attendance/{removed_id}",
            headers={"Authorization": "Bearer admin"},
        )
        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}

    async with AsyncSession(engine) as db:
        from app.api.matches import _recompute_scores

        meetup = await db.get(Meetup, meetup_id)
        assert meetup.content_revision == 1
        assert json.loads(meetup.manual_teams_json) == [[teammate_id], [opponent_id, fourth_id]]
        match = await db.get(MeetupMatch, match_id)
        assert json.loads(match.team_a_users) == [teammate_id]
        assert json.loads(match.team_b_users) == [opponent_id, fourth_id]
        assert (match.score_a, match.score_b, match.score_offset_a, match.score_offset_b) == (2, 2, 1, 1)
        assert (match.penalty_winner, match.penalty_score_a, match.penalty_score_b) == ("a", 3, 2)
        assert await _recompute_scores(db, match) == (2, 2)
        sub = await db.scalar(select(MatchSubstitution).where(MatchSubstitution.match_id == match_id))
        assert json.loads(sub.old_team_a_users) == [teammate_id]
        assert json.loads(sub.new_team_b_users) == [fourth_id]
        goals = {g.intent_id: g for g in await db.scalars(select(MatchGoal))}
        assert set(goals) == {"assist", "keeper", "other-meetup"}
        assert goals["assist"].scorer_id == teammate_id and goals["assist"].assist_id is None
        assert goals["keeper"].scorer_id == opponent_id and goals["keeper"].goalkeeper_id is None
        assert goals["assist"].recorded_by == removed_id
        assert goals["other-meetup"].scorer_id == removed_id
        penalties = {(p.match_id, p.scorer_id) for p in await db.scalars(select(MatchPenalty))}
        assert penalties == {(match_id, teammate_id), (other_match_id, removed_id)}
        scores = {(s.meetup_id, s.player_id) for s in await db.scalars(select(MatchScore))}
        assert scores == {(meetup_id, teammate_id), (other_id, removed_id)}
        ratings = {(r.meetup_id, r.rater_id, r.ratee_id) for r in await db.scalars(select(Rating))}
        assert ratings == {(meetup_id, opponent_id, teammate_id), (meetup_id, fourth_id, teammate_id),
                           (other_id, removed_id, teammate_id)}
        assert (await db.get(User, teammate_id)).calculated_skill == 3
        attendees = {(a.meetup_id, a.user_id, a.status) for a in await db.scalars(select(Attendance))}
        assert attendees == {(meetup_id, teammate_id, "confirmed"), (meetup_id, opponent_id, "waitlisted"),
                             (other_id, removed_id, "confirmed")}
        assert [p.claim_token for p in await db.scalars(select(GuestPlusOne))] == ["keep-guest"]
        awards = {(a.user_id, a.used_meetup_id) for a in await db.scalars(select(WeatherHeroAward))}
        assert awards == {(removed_id, other_id), (teammate_id, None)}

    # Re-adding the player cannot restore their old results.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            f"/meetups/{meetup_id}/admin/attendance", params={"user_id": removed_id},
            headers={"Authorization": "Bearer admin"},
        )
        assert response.status_code == 200
    async with AsyncSession(engine) as db:
        assert json.loads((await db.get(MeetupMatch, match_id)).team_a_users) == [teammate_id]
        assert await db.scalar(select(MatchGoal.id).where(MatchGoal.intent_id == "removed")) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("attendance_status", ["confirmed", "waitlisted", "cancelled"])
async def test_remove_attendance_requires_admin_and_past_meetup(attendance_status):
    async with AsyncSession(engine) as db:
        meetup = await db.scalar(select(Meetup))
        meetup_id = meetup.id
        user_id = await db.scalar(select(User.id).where(User.pocket_id_sub == "p1-uuid"))
        db.add(Attendance(meetup_id=meetup_id, user_id=user_id, status=attendance_status))
        await db.commit()

    url = f"/meetups/{meetup_id}/attendance/{user_id}"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.delete(url)).status_code == 401
        assert (await client.delete(url, headers={"Authorization": "Bearer user"})).status_code == 403
        assert (await client.delete(url, headers={"Authorization": "Bearer admin"})).status_code == 409
        assert (await client.delete(f"/meetups/99999/attendance/{user_id}",
                                    headers={"Authorization": "Bearer admin"})).status_code == 404
        async with AsyncSession(engine) as db:
            meetup = await db.get(Meetup, meetup_id)
            meetup.start_time = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=1)
            await db.commit()
        assert (await client.delete(url, headers={"Authorization": "Bearer admin"})).status_code == 200
        assert (await client.delete(url, headers={"Authorization": "Bearer admin"})).status_code == 404


@pytest.mark.asyncio
async def test_historical_removal_rolls_back_if_skill_refresh_fails(monkeypatch):
    import app.api.meetups as meetups_api

    async with AsyncSession(engine) as db:
        meetup = await db.scalar(select(Meetup))
        meetup.start_time = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=5)
        meetup_id = meetup.id
        user_id = await db.scalar(select(User.id).where(User.pocket_id_sub == "p1-uuid"))
        meetup.manual_teams_json = json.dumps([[user_id]])
        db.add(Attendance(meetup_id=meetup_id, user_id=user_id, status="confirmed"))
        db.add(MatchScore(meetup_id=meetup_id, player_id=user_id, score=1, type="goals"))
        await db.commit()

    async def fail_refresh(db):
        raise RuntimeError("refresh failed")

    monkeypatch.setattr(meetups_api, "refresh_player_skills", fail_refresh)
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        response = await client.delete(
            f"/meetups/{meetup_id}/attendance/{user_id}",
            headers={"Authorization": "Bearer admin"},
        )
        assert response.status_code == 500

    async with AsyncSession(engine) as db:
        meetup = await db.get(Meetup, meetup_id)
        assert meetup.content_revision == 0
        assert json.loads(meetup.manual_teams_json) == [[user_id]]
        assert await db.scalar(select(Attendance.id).where(Attendance.user_id == user_id)) is not None
        assert await db.scalar(select(MatchScore.id).where(MatchScore.player_id == user_id)) is not None


@pytest.mark.asyncio
async def test_concurrent_historical_removals_keep_lineups_and_offsets_consistent():
    async with AsyncSession(engine) as db:
        meetup = await db.scalar(select(Meetup))
        meetup.start_time = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=5)
        meetup_id = meetup.id
        user_ids = list(await db.scalars(select(User.id).where(User.pocket_id_sub.in_(["p1-uuid", "p2-uuid"]))))
        meetup.manual_teams_json = json.dumps([user_ids, []])
        match = MeetupMatch(
            meetup_id=meetup_id, match_number=1, team_a_users=json.dumps(user_ids),
            team_b_users="[]", team_a_name="A", team_b_name="B", score_a=2, score_b=0,
            status="completed", completed_at=meetup.start_time,
        )
        db.add(match)
        await db.flush()
        match_id = match.id
        for user_id in user_ids:
            db.add(Attendance(meetup_id=meetup_id, user_id=user_id, status="confirmed"))
            db.add(MatchGoal(
                match_id=match_id, team="a", scorer_id=user_id, recorded_by=user_id,
                clock_secs=10, clock_minute=1, intent_id=f"concurrent-{user_id}",
            ))
        await db.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        responses = await asyncio.gather(*[
            client.delete(f"/meetups/{meetup_id}/attendance/{user_id}",
                          headers={"Authorization": "Bearer admin"})
            for user_id in user_ids
        ])
        assert [response.status_code for response in responses] == [200, 200]

    async with AsyncSession(engine) as db:
        meetup = await db.get(Meetup, meetup_id)
        match = await db.get(MeetupMatch, match_id)
        assert meetup.content_revision == 2
        assert json.loads(meetup.manual_teams_json) == [[], []]
        assert json.loads(match.team_a_users) == []
        assert (match.score_a, match.score_offset_a) == (2, 2)
        assert list(await db.scalars(select(MatchGoal))) == []
        assert list(await db.scalars(select(Attendance))) == []


@pytest.mark.parametrize("match_status", [None, "pending", "active"])
async def test_remove_promotes_and_balances_pace_before_first_match(match_status):
    async with AsyncSession(engine) as db:
        players = {u.pocket_id_sub: u for u in await db.scalars(select(User))}
        fast, removed, other_a, other_b, waiting = (
            players[name] for name in ("p1-uuid", "p2-uuid", "p3-uuid", "p4-uuid", "user-uuid")
        )
        fast.pac = waiting.pac = 4.2
        meetup = await db.scalar(select(Meetup))
        meetup_id = meetup.id
        removed_id = removed.id
        waiting_id = waiting.id
        pace_ids = {fast.id, waiting.id}
        old_a, old_b = [fast.id, removed.id], [other_a.id, other_b.id]
        meetup.max_players = 4
        meetup.max_teams = 2
        meetup.team_size = 2
        meetup.team_assignment_mode = "auto-balanced"
        meetup.team_names_json = json.dumps(["First", "Second"])
        meetup.manual_teams_json = json.dumps([old_a, old_b])
        db.add_all([
            Attendance(meetup_id=meetup_id, user_id=user_id, status="confirmed")
            for user_id in old_a + old_b
        ])
        if match_status:
            # The referee selected the teams in reverse order.
            db.add(MeetupMatch(
                meetup_id=meetup_id, match_number=1, status=match_status,
                team_a_name="Second", team_b_name="First",
                team_a_users=json.dumps(old_b), team_b_users=json.dumps(old_a),
            ))
        await db.commit()

    admin = {"Authorization": "Bearer admin"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        url = f"/meetups/{meetup_id}/admin/attendance"
        added = await client.post(url, headers=admin, params={"user_id": waiting_id})
        assert added.json() == {"status": "waitlisted"}
        removed_response = await client.delete(f"{url}/{removed_id}", headers=admin)
        assert removed_response.json() == {"status": "deleted"}
        response = await client.get(f"/meetups/{meetup_id}/teams", headers=admin)
        assert response.status_code == 200
        lineup = [{int(p["id"]) for p in team["players"]} for team in response.json()["teams"]]
        assert set.union(*lineup) == (set(old_a + old_b) - {removed_id}) | {waiting_id}
        assert [len(team & pace_ids) for team in lineup] == (
            [2, 0] if match_status == "active" else [1, 1]
        )

    if match_status:
        async with AsyncSession(engine) as db:
            match = await db.scalar(select(MeetupMatch))
            assert (match.team_a_name, match.team_b_name) == ("Second", "First")
            assert set(json.loads(match.team_a_users)) == (
                set(old_b) if match_status == "active" else lineup[1]
            )
            assert set(json.loads(match.team_b_users)) == (
                set(old_a) if match_status == "active" else lineup[0]
            )
