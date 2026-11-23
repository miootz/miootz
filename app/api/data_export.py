"""Admin-only, relational CSV export of the main database."""

import csv
import io
import re
from datetime import UTC, datetime
from tempfile import SpooledTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import JSON, Text, select, type_coerce

from app.api.deps import require_admin
from app.core.database import Base, engine

router = APIRouter()

_EXCLUDED_TABLES = {"chat_messages", "meetup_analytics", "meetup_rating_snapshots"}
_EXCLUDED_COLUMNS = {
    "users": {"calculated_skill"},
    "invite_tokens": {"token"},
    "guest_plus_ones": {"claim_token"},
    "web_push_subscriptions": {"endpoint", "p256dh", "auth"},
    "match_editor_lease": {"release_token"},
}

_README = """Miootz CSV dataset

Each CSV contains a main-database table, with a header even when it has no rows.
Rows are ordered by primary key. foreign_keys.csv lists declared relationships.
Dates are stored as UTC. SQLite booleans are 0 or 1. NULL and empty text both
appear as empty cells. JSON values use their stored JSON representation.

The manual lineups in meetups and team lists in meetup_matches and
match_substitutions contain users.id values. The penalty scorer_id and
substitution recorded_by also reference users.id. For rating_reminder jobs,
job_queue.ref_id references meetups.id. For signup_hold_expiry jobs, it
references meetup_signup_holds.id.

For spreadsheet safety, text beginning with a formula character (=, +, -, @,
or their full-width variants), tab, carriage return, or newline is prefixed
with an apostrophe. The same applies after leading whitespace.
Text already beginning with an apostrophe is also prefixed with one, so the
original text can be recovered by removing one leading apostrophe. Numeric JSON
values remain valid JSON and are not escaped.

This dataset excludes chat, audit logs, calculated skill, and rankings. It
also omits invite tokens (the invites' primary key), guest claim tokens, push
endpoints and keys, and editor release tokens. The remaining data includes
personal information.
"""


def _csv_cell(value, column):
    if not isinstance(value, str):
        return value

    stripped = value.lstrip()
    if isinstance(column.type, JSON) and re.fullmatch(
        r"-(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", value.strip()
    ):
        return value

    leading = value[: len(value) - len(stripped)]
    if (
        value.startswith("'")
        or any(char in "\t\r\n" for char in leading)
        or stripped.startswith(("=", "+", "-", "@", "＝", "＋", "－", "＠"))
    ):
        return "'" + value
    return value


async def _write_table(archive, connection, table):
    columns = [
        column
        for column in table.columns
        if column.name not in _EXCLUDED_COLUMNS.get(table.name, set())
    ]
    # Keep SQLite's stored JSON text, timestamps and boolean integers unchanged.
    statement = select(*(type_coerce(column, Text) for column in columns)).order_by(
        *table.primary_key.columns
    )
    result = await connection.stream(statement)
    try:
        with archive.open(f"{table.name}.csv", "w") as entry:
            with io.TextIOWrapper(entry, encoding="utf-8", newline="") as text:
                writer = csv.writer(text)
                writer.writerow(column.name for column in columns)
                async for row in result.yield_per(500):
                    writer.writerow(
                        _csv_cell(value, column)
                        for column, value in zip(columns, row, strict=True)
                    )
    finally:
        await result.close()


def _write_foreign_keys(archive, tables):
    text = io.StringIO(newline="")
    writer = csv.writer(text)
    writer.writerow(["table", "column", "referenced_table", "referenced_column"])
    for table in tables:
        for key in sorted(
            table.foreign_keys, key=lambda fk: (fk.parent.name, fk.target_fullname)
        ):
            writer.writerow(
                [table.name, key.parent.name, key.column.table.name, key.column.name]
            )
    archive.writestr("foreign_keys.csv", text.getvalue())


class _ArchiveResponse(StreamingResponse):
    def __init__(self, file, **kwargs):
        self.file = file
        super().__init__(iter(lambda: file.read(64 * 1024), b""), **kwargs)

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.file.close()


@router.get("/admin/export")
async def export_data(_=Depends(require_admin)):
    output = SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
    try:
        tables = sorted(
            (
                table
                for table in Base.metadata.tables.values()
                if table.name not in _EXCLUDED_TABLES
            ),
            key=lambda table: table.name,
        )
        with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
            async with engine.connect() as connection:
                # SQLite's deferred BEGIN keeps every SELECT on the same read snapshot.
                await connection.exec_driver_sql("BEGIN")
                for table in tables:
                    await _write_table(archive, connection, table)
            _write_foreign_keys(archive, tables)
            archive.writestr("README.txt", _README)
        output.seek(0)
    except BaseException:
        output.close()
        raise

    filename = f"miootz-export-{datetime.now(UTC).date().isoformat()}.zip"
    return _ArchiveResponse(
        output,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
