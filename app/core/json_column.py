"""Defensive parsing helpers for JSON-encoded SQLite columns.

All writers go through ``json.dumps`` with sane shapes, but rows predating a
migration (or hand-edited during debugging) can contain legacy/garbage
values. These helpers degrade to a default instead of raising a 500 deep
inside serialization code.
"""

from __future__ import annotations

import json
from typing import Any


def loads_int_list(value: str | None) -> list[int]:
    """Parse a JSON int-list DB column, returning [] on garbage."""
    try:
        parsed = json.loads(value) if value else []
    except json.JSONDecodeError, TypeError, ValueError:
        return []
    if not isinstance(parsed, list):
        return []
    try:
        return [int(x) for x in parsed]
    except TypeError, ValueError:
        return []


def loads_any(value: str | None, default: Any = None) -> Any:
    """Parse any JSON DB column, returning *default* on garbage."""
    try:
        return json.loads(value) if value else default
    except json.JSONDecodeError, TypeError, ValueError:
        return default
