"""Explicit child-row cleanup before parent deletes.

SQLite only enforces ON DELETE behavior per-connection (PRAGMA
foreign_keys=ON, set in app.core.database), and the models don't declare
ORM cascades — so each admin delete removes its children explicitly.
Without this, deleting a parent would raise IntegrityError (or, before the
pragma, leave orphan rows that distorted counts).
"""

from __future__ import annotations

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.game_template import GameTemplate  # noqa: F401  (FK target)
from app.models.game_template_subscription import GameTemplateSubscription
from app.models.guest_plus_one import GuestPlusOne
from app.models.invite import InviteToken
from app.models.match import MeetupMatch, MatchSubstitution
from app.models.match_editor_lease import MatchEditorLease
from app.models.match_goal import MatchGoal
from app.models.rating import Rating
from app.models.meetup import Attendance, MatchScore
from app.models.chat import ChatMessage
from app.models.user_notification_preference import UserNotificationPreference
from app.models.web_push_subscription import WebPushSubscription


async def delete_user_children(db: AsyncSession, user_id: int) -> None:
    """Remove every row that references the user before the user row goes."""
    for stmt in (
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
        delete(Attendance).where(Attendance.meetup_id == meetup_id),
        delete(MatchScore).where(MatchScore.meetup_id == meetup_id),
        delete(Rating).where(Rating.meetup_id == meetup_id),
        delete(ChatMessage).where(ChatMessage.meetup_id == meetup_id),
        delete(GuestPlusOne).where(GuestPlusOne.meetup_id == meetup_id),
        delete(MatchGoal).where(MatchGoal.match_id.in_(meetup_match_ids)),
        delete(MatchEditorLease).where(MatchEditorLease.match_id.in_(meetup_match_ids)),
        delete(MeetupMatch).where(MeetupMatch.meetup_id == meetup_id),
    ):
        await db.execute(stmt)
    await db.flush()


async def delete_match_children(db: AsyncSession, match_id: int) -> None:
    """Remove goals, the editor lease and substitution history before the match row goes."""
    for stmt in (
        delete(MatchGoal).where(MatchGoal.match_id == match_id),
        delete(MatchEditorLease).where(MatchEditorLease.match_id == match_id),
        delete(MatchSubstitution).where(MatchSubstitution.match_id == match_id),
    ):
        await db.execute(stmt)
    await db.flush()
