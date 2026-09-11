"""UTC time helpers.

The DB (SQLite) stores naive UTC datetimes throughout. Use ``utcnow()``
for any value that is persisted or compared against persisted values so
storage semantics stay identical to the previous ``datetime.utcnow()``
behavior without the Py3.12 deprecation.
"""

from datetime import datetime, UTC


def utcnow() -> datetime:
    """Naive UTC ``datetime`` (same semantics as the deprecated
    ``datetime.datetime.utcnow()``)."""
    return datetime.now(UTC).replace(tzinfo=None)


def to_utc(dt: datetime) -> datetime:
    """Interpret naive datetimes as UTC and return an aware UTC datetime."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)
