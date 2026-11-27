"""Explicit child-row cleanup before parent deletes.

SQLite only enforces ON DELETE behavior per-connection (PRAGMA
foreign_keys=ON, set in app.core.database), and the models don't declare
ORM cascades — so each admin delete removes its children explicitly.
Without this, deleting a parent would raise IntegrityError (or, before the
pragma, leave orphan rows that distorted counts).
"""

from __future__ import annotations

import json

from fastapi import HTTPException
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.award import WeatherHeroAward
from app.models.game_template import GameTemplate  # noqa: F401  (FK target)
from app.models.game_template_subscription import GameTemplateSubscription
from app.models.guest_plus_one import GuestPlusOne
from app.models.invite import InviteToken
from app.models.match import MatchPenalty, MeetupMatch, MatchSubstitution, PenaltyMiss
from app.models.match_editor_lease import MatchEditorLease
from app.models.match_goal import MatchGoal
from app.models.rating import Rating
from app.models.meetup import Attendance, MatchScore, Meetup
from app.models.chat import ChatMessage, ChatReceipt
from app.models.job_queue import JobQueue
from app.models.user_notification_preference import UserNotificationPreference
from app.models.web_push_subscription import WebPushSubscription


async def delete_meetup_player_data(db: AsyncSession, meetup: Meetup, user_id: int) -> None:
    """Remove one player's results while keeping the other players' match results."""
    match_ids = select(MeetupMatch.id).where(MeetupMatch.meetup_id == meetup.id)
    matches = list(await db.scalars(select(MeetupMatch).where(MeetupMatch.meetup_id == meetup.id)))
    substitutions = await db.scalars(
        select(MatchSubstitution).where(MatchSubstitution.match_id.in_(match_ids))
    )

    def without_player(players):
        if not isinstance(players, list):
            raise ValueError("Invalid lineup")
        return [player for player in players if int(player) != user_id]

    def update_lineups(row, fields):
        for field in fields:
            players = json.loads(getattr(row, field))
            remaining = without_player(players)
            if remaining != players:
                setattr(row, field, json.dumps(remaining))

    try:
        if meetup.manual_teams_json:
            teams = json.loads(meetup.manual_teams_json)
            if not isinstance(teams, list):
                raise ValueError("Invalid lineup")
            meetup.manual_teams_json = json.dumps([without_player(team) for team in teams])
        for match in matches:
            update_lineups(match, ("team_a_users", "team_b_users"))
        for sub in substitutions:
            update_lineups(sub, (
                "old_team_a_users", "old_team_b_users", "new_team_a_users", "new_team_b_users",
            ))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail="Meetup has an invalid lineup") from exc

    matches_by_id = {match.id: match for match in matches}
    goals = await db.scalars(
        select(MatchGoal).where(
            MatchGoal.match_id.in_(match_ids), MatchGoal.scorer_id == user_id
        )
    )
    for goal in goals:
        if goal.deleted_at is None and goal.team in ("a", "b"):
            match = matches_by_id[goal.match_id]
            field = f"score_offset_{goal.team}"
            setattr(match, field, (getattr(match, field) or 0) + 1)
        await db.delete(goal)

    for role in (MatchGoal.assist_id, MatchGoal.goalkeeper_id):
        await db.execute(
            update(MatchGoal)
            .where(MatchGoal.match_id.in_(match_ids), role == user_id)
            .values({role: None})
        )
    for stmt in (
        delete(Attendance).where(Attendance.meetup_id == meetup.id, Attendance.user_id == user_id),
        delete(MatchScore).where(MatchScore.meetup_id == meetup.id, MatchScore.player_id == user_id),
        delete(Rating).where(
            Rating.meetup_id == meetup.id,
            or_(Rating.rater_id == user_id, Rating.ratee_id == user_id),
        ),
        delete(MatchPenalty).where(MatchPenalty.match_id.in_(match_ids), MatchPenalty.scorer_id == user_id),
        delete(PenaltyMiss).where(PenaltyMiss.match_id.in_(match_ids), PenaltyMiss.scorer_id == user_id),
        delete(GuestPlusOne).where(
            GuestPlusOne.meetup_id == meetup.id,
            or_(GuestPlusOne.guest_user_id == user_id, GuestPlusOne.claimed_by_user_id == user_id),
        ),
        delete(WeatherHeroAward).where(
            WeatherHeroAward.granted_meetup_id == meetup.id,
            WeatherHeroAward.user_id == user_id,
            WeatherHeroAward.used_at.is_(None),
            WeatherHeroAward.used_meetup_id.is_(None),
        ),
    ):
        await db.execute(stmt)
    await db.flush()


async def delete_user_children(db: AsyncSession, user_id: int) -> None:
    """Remove every row that references the user before the user row goes."""
    for stmt in (
        delete(JobQueue).where(
            JobQueue.job_type == "chat_notification",
            JobQueue.ref_id.in_(select(ChatMessage.id).where(ChatMessage.user_id == user_id)),
        ),
        delete(ChatReceipt).where(ChatReceipt.user_id == user_id),
        delete(Attendance).where(Attendance.user_id == user_id),
        delete(MatchScore).where(MatchScore.player_id == user_id),
        delete(Rating).where(
            or_(Rating.rater_id == user_id, Rating.ratee_id == user_id)
        ),
        delete(MatchGoal).where(
            or_(
                MatchGoal.scorer_id == user_id,
                MatchGoal.assist_id == user_id,
                MatchGoal.goalkeeper_id == user_id,
                MatchGoal.recorded_by == user_id,
            )
        ),
        delete(MatchEditorLease).where(MatchEditorLease.holder_id == user_id),
        delete(MatchPenalty).where(MatchPenalty.scorer_id == user_id),
        delete(PenaltyMiss).where(PenaltyMiss.scorer_id == user_id),
        delete(GuestPlusOne).where(
            or_(
                GuestPlusOne.inviter_id == user_id,
                GuestPlusOne.guest_user_id == user_id,
                GuestPlusOne.claimed_by_user_id == user_id,
            )
        ),
        delete(WebPushSubscription).where(WebPushSubscription.user_id == user_id),
        delete(UserNotificationPreference).where(
            UserNotificationPreference.user_id == user_id
        ),
        delete(GameTemplateSubscription).where(
            GameTemplateSubscription.user_id == user_id
        ),
        delete(InviteToken).where(InviteToken.user_id == user_id),
        delete(ChatMessage).where(ChatMessage.user_id == user_id),
    ):
        await db.execute(stmt)
    await db.flush()


async def delete_meetup_children(db: AsyncSession, meetup_id: int) -> None:
    """Remove every row that references the meetup (including matches)."""
    meetup_match_ids = select(MeetupMatch.id).where(
        MeetupMatch.meetup_id == meetup_id
    )
    for stmt in (
        delete(JobQueue).where(
            JobQueue.job_type == "chat_notification",
            JobQueue.ref_id.in_(select(ChatMessage.id).where(ChatMessage.meetup_id == meetup_id)),
        ),
        delete(ChatReceipt).where(ChatReceipt.meetup_id == meetup_id),
        delete(Attendance).where(Attendance.meetup_id == meetup_id),
        delete(MatchScore).where(MatchScore.meetup_id == meetup_id),
        delete(Rating).where(Rating.meetup_id == meetup_id),
        delete(ChatMessage).where(ChatMessage.meetup_id == meetup_id),
        delete(GuestPlusOne).where(GuestPlusOne.meetup_id == meetup_id),
        delete(MatchGoal).where(MatchGoal.match_id.in_(meetup_match_ids)),
        delete(MatchPenalty).where(MatchPenalty.match_id.in_(meetup_match_ids)),
        delete(PenaltyMiss).where(PenaltyMiss.match_id.in_(meetup_match_ids)),
        delete(MatchSubstitution).where(MatchSubstitution.match_id.in_(meetup_match_ids)),
        delete(MatchEditorLease).where(MatchEditorLease.match_id.in_(meetup_match_ids)),
        delete(MeetupMatch).where(MeetupMatch.meetup_id == meetup_id),
    ):
        await db.execute(stmt)
    await db.flush()


async def delete_match_children(db: AsyncSession, match_id: int) -> None:
    """Remove goals, the editor lease and substitution history before the match row goes."""
    for stmt in (
        delete(MatchGoal).where(MatchGoal.match_id == match_id),
        delete(MatchPenalty).where(MatchPenalty.match_id == match_id),
        delete(PenaltyMiss).where(PenaltyMiss.match_id == match_id),
        delete(MatchEditorLease).where(MatchEditorLease.match_id == match_id),
        delete(MatchSubstitution).where(MatchSubstitution.match_id == match_id),
    ):
        await db.execute(stmt)
    await db.flush()
