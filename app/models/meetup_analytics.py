"""SQLite read model for meetup statistics and captured player ratings."""

from sqlalchemy import DDL, ForeignKey, JSON, event
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MeetupAnalytics(Base):
    __tablename__ = "meetup_analytics"

    meetup_id: Mapped[int] = mapped_column(
        ForeignKey("meetups.id", ondelete="CASCADE"), primary_key=True
    )
    version: Mapped[int]
    totals: Mapped[dict] = mapped_column(JSON)


class MeetupRatingSnapshot(Base):
    __tablename__ = "meetup_rating_snapshots"

    meetup_id: Mapped[int] = mapped_column(
        ForeignKey("meetups.id", ondelete="CASCADE"), primary_key=True
    )
    # NULL marks a meetup observed while peer reviews were still open.
    ratings: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)


event.listen(
    MeetupAnalytics.__table__,
    "after_create",
    DDL(
        "CREATE INDEX IF NOT EXISTS ix_meetup_matches_completed_at "
        "ON meetup_matches (completed_at) WHERE status = 'completed'"
    ).execute_if(dialect="sqlite"),
)


# Invalidate in the same transaction as a source edit, including bulk imports,
# guest claims and historical corrections that don't publish a live revision.
for source, key in {
    "attendance": "{row}.meetup_id",
    "meetup_matches": "{row}.meetup_id",
    "match_goals": "(SELECT meetup_id FROM meetup_matches WHERE id = {row}.match_id)",
    "match_penalties": "(SELECT meetup_id FROM meetup_matches WHERE id = {row}.match_id)",
    "penalty_misses": "(SELECT meetup_id FROM meetup_matches WHERE id = {row}.match_id)",
    "match_substitutions": "{row}.meetup_id",
    "meetups": "{row}.id",
}.items():
    operations = ("UPDATE",) if source == "meetups" else ("INSERT", "UPDATE", "DELETE")
    for operation in operations:
        rows = {"INSERT": ("NEW",), "UPDATE": ("OLD", "NEW"), "DELETE": ("OLD",)}[operation]
        keys = ", ".join(key.format(row=row) for row in rows)
        trigger_event = "UPDATE OF start_time" if source == "meetups" else operation
        event.listen(
            MeetupAnalytics.__table__,
            "after_create",
            DDL(
                f"CREATE TRIGGER invalidate_meetup_analytics_{source}_{operation.lower()} "
                f"AFTER {trigger_event} ON {source} BEGIN "
                f"DELETE FROM meetup_analytics WHERE meetup_id IN ({keys}); END"
            ).execute_if(dialect="sqlite"),
        )

for dependency in (
    "attendance", "meetup_matches", "match_goals", "match_penalties",
    "penalty_misses", "match_substitutions",
):
    MeetupAnalytics.__table__.add_is_dependent_on(Base.metadata.tables[dependency])
