"""Separate SQLite database for the audit log.

Kept out of the main DB so retention pruning (hourly DELETE) never touches
game data, and so a full audit database can be replaced without a backup.
"""

import logging

from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.core.config import settings
from app.core.database import _ensure_sqlite_parent_dir

logger = logging.getLogger(__name__)

_ensure_sqlite_parent_dir(settings.AUDIT_DATABASE_URL)

audit_engine = create_async_engine(
    settings.AUDIT_DATABASE_URL,
    connect_args={"check_same_thread": False},
)


@event.listens_for(audit_engine.sync_engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


async def init_audit_db() -> None:
    """Create the audit table and enable WAL (idempotent, startup)."""
    from app.models.audit import AuditBase

    async with audit_engine.begin() as conn:
        await conn.run_sync(AuditBase.metadata.create_all)
        await conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        await conn.exec_driver_sql("PRAGMA synchronous=NORMAL")


audit_session = async_sessionmaker(audit_engine, expire_on_commit=False)
