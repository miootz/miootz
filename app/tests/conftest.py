import os
from pathlib import Path

# Writable SQLite path (must exist before the engine is created on first import).
_root = Path(__file__).resolve().parents[2]
_db_path = _root / "data" / "pytest_footy.db"
_db_path.parent.mkdir(parents=True, exist_ok=True)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_path}"

# Avoid background scheduler threads during pytest unless explicitly enabled.
os.environ.setdefault("SCHEDULER_ENABLED", "false")
# Tests send Remote-User without Traefik forwarded headers.
os.environ.setdefault("AUTH_REQUIRE_FORWARDED_HEADERS", "false")
