from datetime import datetime

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.database import Base
from app.core.migrations import run_sqlite_migrations
from app.models.chat import ChatMessage, ChatReceipt
from app.models.meetup import Meetup
from app.models.user import User


async def test_legacy_chat_ids_never_reuse_deleted_messages(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'migration.db'}")

    @event.listens_for(engine.sync_engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        async with AsyncSession(bind=conn) as db:
            db.add_all([
                User(id=1, sso_display_name="Alice"),
                Meetup(id=1, start_time=datetime(2026, 1, 1), location="Pitch"),
            ])
            await db.flush()

        # The old schema did not persist the largest deleted row ID.
        await conn.exec_driver_sql("DROP TABLE chat_messages")
        await conn.exec_driver_sql("""
            CREATE TABLE chat_messages (
                id INTEGER NOT NULL PRIMARY KEY,
                meetup_id INTEGER NOT NULL REFERENCES meetups(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                message VARCHAR NOT NULL,
                created_at DATETIME NOT NULL
            )
        """)
        await conn.exec_driver_sql(
            "CREATE INDEX ix_chat_messages_user_id ON chat_messages (user_id)"
        )
        await conn.exec_driver_sql(
            "CREATE INDEX ix_chat_messages_meetup_id ON chat_messages (meetup_id)"
        )
        await conn.exec_driver_sql("""
            INSERT INTO chat_messages (id, meetup_id, user_id, message, created_at)
            VALUES (1, 1, 1, 'kept', '2026-01-01'), (2, 1, 1, 'deleted', '2026-01-01')
        """)
        await conn.exec_driver_sql("DELETE FROM chat_messages WHERE id = 2")
        await conn.exec_driver_sql("""
            INSERT INTO chat_receipts (meetup_id, user_id, delivered_id, read_id)
            VALUES (1, 1, 2, 2)
        """)

        await run_sqlite_migrations(conn)
        await run_sqlite_migrations(conn)

        async with AsyncSession(bind=conn) as db:
            assert (await db.get(ChatMessage, 1)).message == "kept"
            receipt = await db.get(ChatReceipt, (1, 1))
            assert receipt.read_id == 2
            message = ChatMessage(meetup_id=1, user_id=1, message="new")
            db.add(message)
            await db.flush()
            assert message.id > 2
            first_new_id = message.id
            await db.delete(message)
            await db.flush()
            next_message = ChatMessage(meetup_id=1, user_id=1, message="newer")
            db.add(next_message)
            await db.flush()
            assert next_message.id > first_new_id

        indexes = (await conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='chat_messages'"
        )).scalars().all()
        assert "ix_chat_messages_user_id" in indexes
        assert "ix_chat_messages_meetup_id" in indexes

    await engine.dispose()
