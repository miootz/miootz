"""Player meetup history built from statistics summaries and saved ratings."""

from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.database import async_session
from app.core.timeutil import utcnow
from app.models.meetup import Attendance, Meetup
from app.models.meetup_analytics import MeetupRatingSnapshot
from app.models.user import User
from app.services.rating_settings import get_rating_settings
from app.services.rating_windows import meetup_end_time, utc_now
from app.services.rankings_service import load_meetup_analytics


async def record_due_rating_snapshots() -> None:
    """Observe open review windows and record the saved ratings at the next kickoff."""
    async with async_session() as db:
        now = utcnow()
        newer = aliased(Meetup)
        next_started = select(newer.id).where(
            newer.start_time > Meetup.start_time, newer.start_time <= now
        ).exists()
        due = (
            select(MeetupRatingSnapshot)
            .join(Meetup)
            .where(MeetupRatingSnapshot.ratings.is_(None), next_started)
        )
        latest = await db.scalar(
            select(Meetup).where(Meetup.start_time <= now)
            .order_by(Meetup.start_time.desc()).limit(1)
        )
        observe = (
            latest is not None
            and not latest.skipped
            and meetup_end_time(latest) <= utc_now()
            and await db.get(MeetupRatingSnapshot, latest.id) is None
        )
        if not observe and await db.scalar(due.limit(1)) is None:
            return
        await db.execute(text("BEGIN IMMEDIATE"))
        settings = await get_rating_settings(db)
        for snapshot in await db.scalars(due):
            players = await db.scalars(
                select(User).join(Attendance).where(
                    Attendance.meetup_id == snapshot.meetup_id, Attendance.status == "confirmed"
                )
            )
            snapshot.ratings = {
                str(player.id): {
                    "base": player.seed_skill,
                    "adjusted": player.calculated_skill if settings.computed_scores else None,
                }
                for player in players
            }
        if observe and latest is not None and await db.get(MeetupRatingSnapshot, latest.id) is None:
            db.add(MeetupRatingSnapshot(meetup_id=latest.id))
        await db.commit()


async def get_player_progress(db: AsyncSession, user_id: int, year: int | None) -> dict:
    query = select(Meetup).where(Meetup.skipped.is_(False), Meetup.start_time <= utcnow())
    if year is not None:
        query = query.where(Meetup.start_time.between(datetime(year, 1, 1), datetime(year, 12, 31, 23, 59, 59, 999999)))
    now = utc_now()
    meetups = [
        meetup for meetup in await db.scalars(query.order_by(Meetup.start_time, Meetup.id))
        if meetup_end_time(meetup) <= now
    ]
    summaries = await load_meetup_analytics(db, meetups)
    user_key = str(user_id)
    played = []
    for meetup in meetups:
        summary = summaries.get(meetup.id)
        metrics = summary["all"][0].get(user_key) if summary is not None else None
        if metrics and metrics["matches"]:
            played.append((meetup, metrics))
    if year is None:
        played = played[-8:]

    snapshots = {
        row.meetup_id: (row.ratings or {}).get(user_key, {})
        for row in await db.scalars(
            select(MeetupRatingSnapshot).where(
                MeetupRatingSnapshot.meetup_id.in_([meetup.id for meetup, _ in played])
            )
        )
    }
    computed_scores = (await get_rating_settings(db)).computed_scores
    return {
        "computed_scores": computed_scores,
        "meetups": [
            {
                "meetup_id": meetup.id,
                "start_time": meetup.start_time.isoformat() + "Z",
                **{key: stats[key] for key in ("matches", "goals", "assists", "wins", "clean_sheets")},
                "base_rating": snapshots.get(meetup.id, {}).get("base"),
                "adjusted_rating": snapshots.get(meetup.id, {}).get("adjusted") if computed_scores else None,
            }
            for meetup, stats in played
        ],
    }
