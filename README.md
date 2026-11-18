# Miootz

Miootz is an amateur-football meetup app: organize weekly sessions, invite members
through passkey-based OIDC (Pocket ID), manage join/leave lists and waitlists, chat,
and run live matches with timer, score, and post-match peer ratings. Notifications are
**Web Push only** (VAPID) — there is no mail delivery in the stack.

Stack: FastAPI backend (`app/`), React + Vite frontend (`frontend/`), Docker Compose
with Traefik + Pocket ID.

## Quick Start

1. Create the environment files — they **must exist before `docker compose up`**:

   ```bash
   cp .env.example .env            # prod stack (docker-compose.yml)
   cp .env.dev.example .env.dev    # dev stack (docker-compose.dev.yml)
   ```

2. Bootstrap the full stack (Pocket ID + API + Frontend) in one command:

   ```bash
   ./scripts/bootstrap.sh --dev --admin-username yourname
   ```

   See [INITIAL_SETUP.md](INITIAL_SETUP.md) for the full chain, hostnames
   (`${APP_DOMAIN}` / `${API_DOMAIN}` / `${AUTH_DOMAIN}` from `.env`), and the
   `/etc/hosts` requirement for local development.

## Demo (local, no passkey)

Run `.venv/bin/python -m app.demo --scenario full`, then open
[the local demo menu](http://127.0.0.1:5180/api/demo). This uses fictional data in
a temporary database and requires no passkey. See [the demo guide](docs/DEMO.md)
for scenarios, account switching, screenshot routes, and integration limits.

## Showcase

The [showcase guide](docs/SHOWCASE.md) is a feature walkthrough built from recorded
video clips (one per feature) with poster images; it is deployed at your own
configured showcase site.

## Development Setup (Local)

### Backend

1. Install dependencies (ensure you have Python 3.14+ installed; `uv` manages the env).
2. Run the API server:
   ```bash
   uv run uvicorn app.api.main:app --reload
   ```
3. Run tests:
   ```bash
   uv run pytest
   ```

### Frontend

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Run linting or tests:
   ```bash
   npm run lint
   npm run test
   ```

## Infrastructure

### Docker Development

To run the full infrastructure stack locally (Traefik, Pocket ID, API, frontend —
no mail server; notifications are Web Push via VAPID):

```bash
docker compose -f docker-compose.dev.yml up -d
```

- **Frontend**: `https://${APP_DOMAIN}:8443` (dev) / `https://${APP_DOMAIN}` (prod)
- **API**: `https://${API_DOMAIN}:8443` (dev) / `https://${API_DOMAIN}` (prod)
- **Pocket ID**: `https://${AUTH_DOMAIN}:8443` (dev) / `https://${AUTH_DOMAIN}` (prod)

Hostnames are read from `.env` / `.env.dev`. For local development, point
`app`/`api`/`auth` at `127.0.0.1` via `/etc/hosts` (or local DNS). The Traefik
configuration lives in the `docker/` directory.

### Create an admin (database only)

Run the CLI **inside the API container** so it uses the same `DATABASE_URL` as the
running stack:

```bash
docker compose -f docker-compose.dev.yml exec api \
  uv run python -m app.cli --username <uid> --email <email> [--display-name "Full Name"]
```

This creates a database user with `is_admin=True`. To grant admin access in Pocket ID,
visit `https://${AUTH_DOMAIN}/login/setup` (`:8443` for dev) to create your admin
account, then add yourself to the `admins` group in the Pocket ID admin UI.

### Demo data

The showcase runner seeds a self-contained demo (20 fictional members, an
upcoming meetup, past meetups with matches, goals and ratings) in a temporary
database with demo accounts you pick at `/api/demo`:

```bash
uv run python -m app.demo --scenario full
```

See `docs/DEMO.md` for the scenarios and `docs/SHOWCASE.md` for recording the
demo site.

## Import Auto team maker history

Run the importer from the repository root on the host, with Python 3.14+ and
`uv` installed. It reads the workbook's cached values and imports its roster,
meetups, matches, goals and shootout kicks into an inactive `Auto team maker`
template. The `Stats` sheet is for comparison; it does not set player stats.
The Roster sheet's `Tokens` column supplies each player's starting balance of
Weather Hero awards. A blank cell means zero. Reruns add any increase in the
recorded balance and preserve redeemed awards and awards granted in Miootz.
Save the workbook with up-to-date calculated values before importing.
Penalty stats include scored in-game penalties and recorded shootout kicks.
The app has no event type for a missed in-game penalty, so the importer reports
one if it appears in the workbook.

For a local, separate SQLite database:

```bash
uv run --with openpyxl python -m scripts.import_team_maker \
  "/path/to/Auto team maker.xlsx" --database ./data/team-maker-import.db
```

Back up an existing target first. The importer commits before it reports the
`Stats` comparison, so exit status 1 can mean the import succeeded with
`Stats mismatch` warnings. Review those and other source warnings. Reruns update
matching imported records and can replace manual edits; they do not remove
nights or matches omitted from the workbook.

To connect an existing Pocket ID account to its historical player, add
`--link-pocket-id 'PLAYER=UUID'` for each account, using the exact roster name
and the verified Pocket ID user UUID. The importer grants Miootz admin access to
`Alex Example` and `Casey Sample`, so verify those identities especially carefully. Unlinked
players need an invite linked to their imported user to claim their history;
signing in separately can create another user.

### Production import

Schedule downtime: the API must stay stopped while its database is copied and
imported. Have Python 3.14+, `uv`, the matching application code and the workbook
available on the server. On an existing deployment, stop the API and back up its
databases before updating `./app`, which Compose mounts into the running API.
For a new deployment, set both values in `.env` **before** running bootstrap:

```dotenv
DATABASE_URL=sqlite+aiosqlite:////data/miootz.db
AUDIT_DATABASE_URL=sqlite+aiosqlite:////data/audit.db
```

Then follow the [initial setup guide](INITIAL_SETUP.md) to start the stack.

Compose mounts host `./data` at `/data` in the API container. The example's
relative database URL instead resolves under `/app/data` in the container, which
is not that mount. For an existing deployment, do not change its URLs or recreate
the container until you have located and backed up both databases. Check the
paths used by the running API:

```bash
docker compose --env-file .env -f docker-compose.yml exec -T api uv run --no-sync python -c '
from pathlib import Path
from sqlalchemy.engine import make_url
from app.core.config import settings
for name in ("DATABASE_URL", "AUDIT_DATABASE_URL"):
    url = make_url(getattr(settings, name))
    if url.get_backend_name() == "sqlite" and url.database not in (None, "", ":memory:"):
        print(f"{name}: {Path(url.database).resolve()}")
    else:
        print(f"{name}: not a file-based SQLite database")
'
```

If either path is not a file-based SQLite database, these instructions do not
apply. Do not import until you have identified the correct database files.

Stop the API and any other process that can write either database:

```bash
docker compose --env-file .env -f docker-compose.yml stop api
```

If either database is outside `/data`, migrate it before proceeding. For the
default `/app/data` location, copy that entire directory, including any `-wal`
and `-shm` files, to a private backup directory while the container is stopped:

```bash
snapshot_dir=$(mktemp -d)
docker cp miootz_api:/app/data/. "$snapshot_dir/"
```

Use SQLite's backup API to copy each database that was outside the mount into
`./data`. For example, for `/app/data/miootz.db`, run the command below; repeat
with `audit.db` if the audit database was also outside the mount. For other
paths, first copy that database and its sidecar files to a private directory and
use the copied path as the source. Use `./data/miootz.db` for the main database
and `./data/audit.db` for the audit database. This refuses to overwrite an
existing destination or its sidecar files.

```bash
mkdir -p ./data
uv run python - "$snapshot_dir/miootz.db" ./data/miootz.db <<'PY'
import sqlite3, sys
from pathlib import Path

source, target = map(Path, sys.argv[1:])
target_exists = any(
    Path(str(target) + suffix).exists() for suffix in ("", "-wal", "-shm", "-journal")
)
if not source.is_file() or target_exists:
    raise SystemExit("Source is missing or target already exists; stop and investigate")
with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as original:
    with sqlite3.connect(target) as backup:
        original.backup(backup)
PY
```

Keep the snapshot in protected storage. For each database you moved, set the
corresponding `.env` value shown above to use the migrated file. Leave an
already-mounted database's URL unchanged. If a destination already exists,
resolve which database is current before changing the configuration. The
commands below assume the API uses `/data/miootz.db`; for another SQLite path,
verify its host mapping and substitute the correct file.

Before importing, make a separate SQLite backup of the target database:

```bash
backup_dir=$(mktemp -d)
uv run python - "$backup_dir/miootz-before-import.db" <<'PY'
import sqlite3, sys
with sqlite3.connect("file:data/miootz.db?mode=ro", uri=True) as original:
    with sqlite3.connect(sys.argv[1]) as backup:
        original.backup(backup)
PY
printf 'Backup: %s\n' "$backup_dir/miootz-before-import.db"
```

Store the backup in protected storage outside the server. Install the matching
application code, then import into the database the API will use:

```bash
uv run --with openpyxl python -m scripts.import_team_maker \
  "/path/to/Auto team maker.xlsx" --database ./data/miootz.db
```

Review the warnings and `Stats` comparison before restarting. If they show a
problem, correct the workbook and rerun, or restore the backup while the API
remains stopped. After review, restart the API and apply any `.env` changes:

```bash
docker compose --env-file .env -f docker-compose.yml up -d --no-deps api
```

## License

MIT — see [LICENSE](LICENSE).
