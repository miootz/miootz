"""Move a guest reservation to an authenticated member without duplicating identities."""

import json
from typing import cast

from fastapi import HTTPException
from sqlalchemy import or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.guest_plus_one import GuestPlusOne
from app.models.match import MatchPenalty, MatchSubstitution, MeetupMatch, PenaltyMiss
from app.models.match_goal import MatchGoal
from app.models.rating import Rating
from app.models.meetup import Attendance, Meetup, MatchScore
from app.models.user import User
from app.services.meetup_revision import bump_meetup_revision
from app.services.skill_service import (
    refresh_skills_after_meetup,
    update_user_calculated_skill,
)
from app.core.timeutil import utcnow


async def claim_reservation(
    db: AsyncSession, reservation: GuestPlusOne, member: User
) -> int | None:
    """Keep the member account and move the reserved attendance, teams, and results.

    The original placeholder remains linked to the reservation for its audit trail.
    An active member cannot consume a second place in the same meetup.
    """
    if reservation.status == "claimed":
        if reservation.claimed_by_user_id == member.id:
            return None  # Retrying a successful claim is safe.
        raise HTTPException(
            status_code=409, detail="This spot has already been claimed"
        )
    if reservation.status != "pending":
        raise HTTPException(
            status_code=410, detail="This reservation is no longer available"
        )
    if reservation.inviter_id == member.id:
        raise HTTPException(
            status_code=409,
            detail="Sign in with the guest's account to claim this spot",
        )

    sid = reservation.meetup_id
    guest_id = reservation.guest_user_id
    attendance = await db.scalar(
        select(Attendance).where(
            Attendance.meetup_id == sid,
            Attendance.user_id == guest_id,
        )
    )
    if not attendance or attendance.status not in ("confirmed", "waitlisted"):
        raise HTTPException(
            status_code=410, detail="This reservation is no longer available"
        )
    existing = await db.scalar(
        select(Attendance).where(
            Attendance.meetup_id == sid,
            Attendance.user_id == member.id,
        )
    )
    if existing and existing.status in ("confirmed", "waitlisted"):
        raise HTTPException(
            status_code=409,
            detail="You already have a place or a waitlist entry. Leave it before claiming this reservation.",
        )

    # Only one claimant can win, including requests that read the same pending row.
    claimed = cast(
        CursorResult,
        await db.execute(
            update(GuestPlusOne)
            .where(
                GuestPlusOne.id == reservation.id,
                GuestPlusOne.status == "pending",
            )
            .values(status="claimed", claimed_by_user_id=member.id, claimed_at=utcnow())
        ),
    )
    if claimed.rowcount != 1:
        raise HTTPException(
            status_code=409, detail="This spot has already been claimed"
        )

    if existing:
        await db.delete(existing)
    attendance.user_id = member.id  # Preserve status and original waitlist ordering.
    if member.seed_skill is None and member.calculated_skill is None:
        member.seed_skill = float(reservation.skill)

    meetup = await db.get(Meetup, sid)
    if meetup is None:
        raise HTTPException(
            status_code=410, detail="This reservation is no longer available"
        )
    if meetup.manual_teams_json:
        try:
            teams = json.loads(meetup.manual_teams_json)
        except TypeError, ValueError:
            teams = []
        if teams:
            meetup.manual_teams_json = json.dumps(
                [
                    [member.id if uid == guest_id else uid for uid in team]
                    for team in teams
                ]
            )
    matches = (
        await db.scalars(select(MeetupMatch).where(MeetupMatch.meetup_id == sid))
    ).all()
    for match in matches:
        for field in ("team_a_users", "team_b_users"):
            raw = getattr(match, field, None)
            if not raw:
                continue
            try:
                ids = json.loads(raw)
            except TypeError, ValueError:
                continue
            setattr(
                match,
                field,
                json.dumps([member.id if uid == guest_id else uid for uid in ids]),
            )
    match_ids = select(MeetupMatch.id).where(MeetupMatch.meetup_id == sid)
    substitutions = await db.scalars(
        select(MatchSubstitution).where(MatchSubstitution.match_id.in_(match_ids))
    )
    for sub in substitutions:
        for field in (
            "old_team_a_users", "old_team_b_users",
            "new_team_a_users", "new_team_b_users",
        ):
            raw = getattr(sub, field)
            try:
                ids = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if isinstance(ids, list) and guest_id in ids:
                setattr(
                    sub, field,
                    json.dumps([member.id if uid == guest_id else uid for uid in ids]),
                )
    for role in (MatchGoal.scorer_id, MatchGoal.assist_id, MatchGoal.goalkeeper_id):
        await db.execute(
            update(MatchGoal)
            .where(MatchGoal.match_id.in_(match_ids), role == guest_id)
            .values({role: member.id})
        )
    for model in (MatchPenalty, PenaltyMiss):
        await db.execute(
            update(model)
            .where(model.match_id.in_(match_ids), model.scorer_id == guest_id)
            .values(scorer_id=member.id)
        )
    await db.execute(
        update(MatchScore)
        .where(
            MatchScore.meetup_id == sid,
            MatchScore.player_id == guest_id,
        )
        .values(player_id=member.id)
    )

    # Claims can happen after a game. Preserve peer ratings without duplicate/self ratings.
    ratings = (
        await db.scalars(
            select(Rating).where(
                Rating.meetup_id == sid,
                or_(Rating.rater_id == guest_id, Rating.ratee_id == guest_id),
            )
        )
    ).all()
    for rating in ratings:
        rater = member.id if rating.rater_id == guest_id else rating.rater_id
        ratee = member.id if rating.ratee_id == guest_id else rating.ratee_id
        duplicate = await db.scalar(
            select(Rating.id).where(
                Rating.meetup_id == sid,
                Rating.rater_id == rater,
                Rating.ratee_id == ratee,
            )
        )
        if rater == ratee or duplicate is not None:
            await db.delete(rating)
        else:
            rating.rater_id, rating.ratee_id = rater, ratee

    await db.flush()
    await refresh_skills_after_meetup(db, sid)
    await update_user_calculated_skill(db, user_id=member.id, commit=False)
    return await bump_meetup_revision(db, sid)
