import logging
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.engine.url import make_url
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings
from collections.abc import AsyncGenerator

logger = logging.getLogger(__name__)


def _ensure_sqlite_parent_dir(database_url: str) -> None:
    """Create parent directory for file-based SQLite so CLI and first boot do not fail."""
    try:
        url = make_url(database_url)
    except Exception:
        return
    if not url.drivername.startswith("sqlite"):
        return
    db = url.database
    if not db or db == ":memory:":
        return
    path = Path(db)
    if not path.is_absolute():
        path = Path.cwd() / path
    path = path.resolve()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        # e.g. Docker URL `sqlite+aiosqlite:////data/miootz.db` on a host where `/data` is read-only / missing
        logger.debug(
            "Skipping SQLite parent mkdir for %s (%s).",
            path.parent,
            exc,
        )


_ensure_sqlite_parent_dir(settings.DATABASE_URL)

engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
)

# SQLite ignores ON DELETE behavior / FK constraints unless the pragma is set
# on *every* connection. Enforced here so deletes actually cascade at the
# statement level and orphan rows cannot be inserted (issue: counts drifting
# higher all season).
@event.listens_for(engine.sync_engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    async with engine.begin() as conn:
        # Enable WAL mode for SQLite
        await conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        await conn.exec_driver_sql("PRAGMA synchronous=NORMAL")


async def get_db() -> AsyncGenerator[AsyncSession]:
    async with async_session() as session:
        yield session
