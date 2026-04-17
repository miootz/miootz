"""Lightweight additive SQLite migrations (no Alembic)."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


async def run_sqlite_migrations(conn: AsyncConnection) -> None:
    async def has_column(table: str, col: str) -> bool:
        r = await conn.execute(text(f'PRAGMA table_info("{table}")'))
        rows = r.fetchall()
        return any(row[1] == col for row in rows)

    async def has_table(name: str) -> bool:
        r = await conn.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:n LIMIT 1"),
            {"n": name},
        )
        return r.scalar_one_or_none() is not None

    if not await has_column("game_sessions", "min_players"):
        await conn.execute(
            text("ALTER TABLE game_sessions ADD COLUMN min_players INTEGER DEFAULT 10")
        )
    if not await has_column("game_sessions", "latitude"):
        await conn.execute(
            text("ALTER TABLE game_sessions ADD COLUMN latitude FLOAT")
        )
    if not await has_column("game_sessions", "longitude"):
        await conn.execute(
            text("ALTER TABLE game_sessions ADD COLUMN longitude FLOAT")
        )
    if not await has_column("game_sessions", "waitlist_mode"):
        await conn.execute(
            text(
                "ALTER TABLE game_sessions ADD COLUMN waitlist_mode VARCHAR DEFAULT 'auto_promote'"
            )
        )

    if not await has_column("attendance", "previous_status"):
        await conn.execute(
            text("ALTER TABLE attendance ADD COLUMN previous_status VARCHAR")
        )

    if not await has_column("game_sessions", "content_revision"):
        await conn.execute(
            text("ALTER TABLE game_sessions ADD COLUMN content_revision INTEGER DEFAULT 0")
        )

    if not await has_column("game_sessions", "recurrence_rule_id"):
        await conn.execute(
            text("ALTER TABLE game_sessions ADD COLUMN recurrence_rule_id INTEGER")
        )
        await conn.execute(
            text(
                'CREATE INDEX IF NOT EXISTS ix_game_sessions_recurrence_rule_id '
                "ON game_sessions (recurrence_rule_id)"
            )
        )

    if await has_table("session_recurrence_rules"):
        _added_announce = False
        if not await has_column("session_recurrence_rules", "announce_timezone"):
            await conn.execute(
                text(
                    "ALTER TABLE session_recurrence_rules ADD COLUMN announce_timezone VARCHAR DEFAULT 'UTC'"
                )
            )
            _added_announce = True
        if not await has_column("session_recurrence_rules", "announce_weekday"):
            await conn.execute(
                text(
                    "ALTER TABLE session_recurrence_rules ADD COLUMN announce_weekday INTEGER DEFAULT 0"
                )
            )
            _added_announce = True
        if not await has_column("session_recurrence_rules", "announce_hour"):
            await conn.execute(
                text(
                    "ALTER TABLE session_recurrence_rules ADD COLUMN announce_hour INTEGER DEFAULT 9"
                )
            )
            _added_announce = True
        if not await has_column("session_recurrence_rules", "announce_minute"):
            await conn.execute(
                text(
                    "ALTER TABLE session_recurrence_rules ADD COLUMN announce_minute INTEGER DEFAULT 0"
                )
            )
            _added_announce = True
        if _added_announce:
            await conn.execute(
                text(
                    """UPDATE session_recurrence_rules SET
                    announce_timezone = timezone,
                    announce_weekday = weekday,
                    announce_hour = hour,
                    announce_minute = minute"""
                )
            )

    if not await has_column("game_sessions", "team_assignment_mode"):
        await conn.execute(
            text(
                "ALTER TABLE game_sessions ADD COLUMN team_assignment_mode VARCHAR DEFAULT 'balanced'"
            )
        )

    if not await has_column("game_sessions", "kickoff_reminder_sent_at"):
        await conn.execute(
            text(
                "ALTER TABLE game_sessions ADD COLUMN kickoff_reminder_sent_at TIMESTAMP"
            )
        )

    if await has_table("session_recurrence_rules") and not await has_column(
        "session_recurrence_rules", "team_assignment_mode"
    ):
        await conn.execute(
            text(
                "ALTER TABLE session_recurrence_rules ADD COLUMN team_assignment_mode VARCHAR DEFAULT 'balanced'"
            )
        )

    if await has_table("ratings"):
        if not await has_column("ratings", "updated_at"):
            await conn.execute(
                text(
                    "ALTER TABLE ratings ADD COLUMN updated_at TIMESTAMP"
                )
            )
            await conn.execute(
                text("UPDATE ratings SET updated_at = created_at WHERE updated_at IS NULL")
            )
        ridx = await conn.execute(
            text(
                "SELECT 1 FROM sqlite_master WHERE type='index' AND name='uq_rating_session_rater_ratee' LIMIT 1"
            )
        )
        if ridx.scalar_one_or_none() is None:
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_rating_session_rater_ratee "
                    "ON ratings (session_id, rater_id, ratee_id)"
                )
            )
