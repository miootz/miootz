"""Lightweight additive SQLite migrations (no Alembic)."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


async def run_sqlite_migrations(conn: AsyncConnection) -> None:
    async def has_column(table: str, col: str) -> bool:
        r = await conn.execute(text(f'PRAGMA table_info("{table}")'))
        rows = r.fetchall()
        return any(row[1] == col for row in rows)

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
