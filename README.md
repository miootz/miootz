# Miootz

## 100% organic, human-written content below

Miootz was an experiment of how far we can go (and how far we've gotten) using only local, open-weight AI models. As of its first public repo push, the code was exclusively "written" using a combination of Qwen models (from 3.6 thru 3.8, from 27b dense to 35b-A3B MoE), using Pi and OpenCode (v1 and v2). It is fully vibe-coded, without manually checking the code, but with full (human) manual testing of all features of the app.

I believe this is the way to responsibly use AI for development (as of mid-2026): abstract away the code itself, focus on the working features, minimize the potential security impact. As such, this app tries to avoid storing any PII such as email addresses, phone numbers or anything else. It exclusively uses passkeys for auth and relies on side-channels for invites.

Going forward, I encourage other contributors to responsibly vibe-code features and PRs, and to specify which models, coding harnesses and rough amount of tokens used, so we can all learn and adjust to this new reality of software development. Include a screenshot or video of the feature your PR adds, as proof it was human-tested before submitting.

## End of organic content, fully AI-written content follows


Miootz is an amateur-football meetup app: organize weekly sessions, invite members
through passkey-based OIDC (Pocket ID), manage join/leave lists and waitlists, chat,
and run live matches with timer, score, and post-match peer ratings. Notifications are
**Web Push only** (VAPID) — there is no mail delivery in the stack.

Stack: FastAPI backend (`app/`), React + Vite frontend (`frontend/`), Docker Compose
with Traefik + Pocket ID.

## Team balancing

Miootz can draft confirmed players by skill or assign them in random order.
Admins can review and adjust the lineups. The balanced draft uses overall skill.
With every input available, skill combines an admin or imported seed (55%),
peer ratings (25%), shooting (6%), passing (5%), defending (5%), pace (2%), and
dribbling (2%). Miootz calculates shooting, passing, and defending from match
data. Admins can set pace and dribbling. Rankings shows the match-derived
attributes for the selected period, and profiles show current attributes and
overall skill. See the [team balancing guide](docs/TEAM_BALANCING.md) for the
formulas and how missing data affects the result.

## Quick Start

1. Prepare the local hostnames and TLS certificates as described in
   [INITIAL_SETUP.md](INITIAL_SETUP.md), then create the environment file:

   ```bash
   cp .env.dev.example .env.dev    # dev stack (docker-compose.dev.yml)
   ```

2. Bootstrap the full stack (Pocket ID + API + Frontend) in one command:

   ```bash
   ./scripts/bootstrap.sh --dev
   ```

   See [INITIAL_SETUP.md](INITIAL_SETUP.md) to create the admin account and
   complete the setup.

## Demo (local, no passkey)

Install the Python and frontend dependencies, then start the demo:

```bash
uv sync
npm ci --prefix frontend
uv run python -m app.demo --scenario full
```

Open
[the local demo menu](http://127.0.0.1:5180/api/demo). This uses fictional data in
a temporary database and requires no passkey. See the [demo guide](docs/DEMO.md)
to run both hosted-style rooms locally and try them with multiple accounts.

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

### Production deployment

For version 1.0.0 releases and server operations, see the
[deployment guide](docs/DEPLOYMENT.md).

Use a Linux server with Docker Compose, a domain you control, and persistent
storage. For a small league, 2 CPU cores and 4 GB RAM are a starting estimate;
this configuration has not been load-tested. Run the commands below from the
repository root on that server. Use a separate host from the development/demo
stacks, which share container names.

1. Point the public DNS records for your app, API, and authentication hostnames
   at the server. Allow inbound TCP ports **80 and 443**. Only publish IPv6
   records if the server is reachable over IPv6 too. With Cloudflare DNS, start
   with the records set to **DNS only**.
2. Copy `.env.example` to `.env` and edit it before starting:

   ```bash
   cp .env.example .env
   ```

   Set `APP_DOMAIN`, `API_DOMAIN`, `AUTH_DOMAIN`, and `ACME_EMAIL` (a contact
   email for Let's Encrypt). Set `PUBLIC_APP_URL` to `https://` followed by
   `APP_DOMAIN`, and update `TRUSTED_HOSTS` to your three hostnames. The bootstrap
   generates the Pocket ID keys. Configure the VAPID keys if you want Web Push
   notifications. Install Python 3.14+ and uv as described in
   [the setup guide](INITIAL_SETUP.md).
3. Bootstrap production:

   ```bash
   ./scripts/bootstrap.sh
   ```

   Traefik obtains and renews Let's Encrypt certificates automatically. Port 80
   must remain reachable for renewal; other HTTP traffic redirects to HTTPS.
4. Open `https://<AUTH_DOMAIN>/login/setup`, create your account and passkey,
   then grant it Miootz admin access:

   ```bash
   ./scripts/bootstrap.sh --add-to-admins yourname
   ```

5. Open `https://<APP_DOMAIN>` and check the proxy logs for certificate errors:

   ```bash
   docker compose --env-file .env -f docker-compose.yml logs --tail=100 traefik
   ```

#### Stop, restart, and update

Stop without deleting containers or data:

```bash
docker compose --env-file .env -f docker-compose.yml stop
```

Restart an existing deployment:

```bash
docker compose --env-file .env -f docker-compose.yml up -d
```

Before updates, stop the stack and back up the application and audit databases,
Pocket ID data, `.env` (including its encryption key), and the `traefik_acme`
Docker volume to protected storage outside the server. Verify where both SQLite
files actually live: the example's relative database URL may resolve inside the
API container rather than the `data/` mount. See the database path check in
[Production import](#production-import) and the [deployment guide](docs/DEPLOYMENT.md).
Do not run `docker compose down -v`: it deletes
certificate storage and other Compose-managed volumes. The Docker volume name
normally includes the Compose project prefix.

For a source-based deployment, after pulling updated repository code, pull
service images and rebuild:

```bash
docker compose --env-file .env -f docker-compose.yml pull
docker compose --env-file .env -f docker-compose.yml up -d --build
```

See [production HTTPS setup and troubleshooting](INITIAL_SETUP.md#production-https-lets-encrypt)
for DNS, firewall, and Cloudflare proxy requirements.

### Docker Development

To run the full infrastructure stack locally (Traefik, Pocket ID, API, frontend):

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d
```

- **Frontend**: `https://${APP_DOMAIN}:8443` (dev) / `https://${APP_DOMAIN}` (prod)
- **API**: `https://${API_DOMAIN}:8443` (dev) / `https://${API_DOMAIN}` (prod)
- **Pocket ID**: `https://${AUTH_DOMAIN}:8443` (dev) / `https://${AUTH_DOMAIN}` (prod)

Hostnames are read from `.env` / `.env.dev`. For local development, point
`app`/`api`/`auth` at `127.0.0.1` via `/etc/hosts` (or local DNS). The Traefik
configuration lives in the `docker/` directory.

## Import spreadsheet history

Run the importer from the repository root on the host, with Python 3.14+ and
`uv` installed. It reads the workbook's cached values and imports its roster,
meetups, matches, goals and shootout kicks. The `Stats` sheet is for comparison
and supplies no stored player stats. A `Y` in the Roster sheet's `Runs` column
sets Pace (PAC) to 4.0 if the player has no PAC value. The `Tokens` column supplies
each player's starting balance of Weather Hero awards. A blank cell means zero.
Reruns add any increase in the recorded balance and preserve redeemed awards
and awards granted in Miootz.
Save the workbook with up-to-date calculated values before importing.
Penalty stats include scored in-game penalties and recorded shootout kicks.
The app has no event type for a missed in-game penalty, so the importer reports
one if it appears in the workbook.

Before importing, create a template for the history in **Admin → Templates**,
including when starting with a fresh database. Turn off **Schedule active** if
the template must not create future meetups. Open the template and note its ID
from the final number in the URL. Supply the historical kickoff time, IANA
timezone, and exact roster name of the person credited with recording the
events. The values below are examples; use the same template, time, and
timezone on each rerun so imported records keep their stable identities.

For a local, separate SQLite database containing that template:

```bash
uv run --with openpyxl python -m scripts.import_team_maker \
  "/path/to/history.xlsx" --database ./data/team-maker-import.db \
  --template-id 42 --kickoff 19:00 --timezone Europe/London \
  --recorded-by 'Player Name'
```

Back up an existing target first. The importer commits before it reports the
`Stats` comparison, so exit status 1 can mean the import succeeded with
`Stats mismatch` warnings. Review those and other source warnings. Reruns update
matching imported records and can replace manual edits; they do not remove
nights or matches omitted from the workbook.

To connect an existing Pocket ID account to its historical player, add
`--link-pocket-id 'PLAYER=UUID'` for each account, using the exact roster name
and the verified Pocket ID user UUID. Unlinked players need an invite linked to
their imported user to claim their history;
signing in separately can create another user.

Use `--date-correction 'YYYY-MM-DD=YYYY-MM-DD'` to correct a workbook date and
`--admin 'PLAYER'` to grant a player administrator access explicitly. Each flag
can be repeated. Only grant admin access to identities you have verified.

### Production import

For a deployment managed by the release workflow, run the commands below from
the current release and select its Compose project and persistent data:

```bash
cd ~/miootz/production/current
export COMPOSE_PROJECT_NAME=miootz
export MIOOTZ_DATA_DIR="$HOME/miootz/production/data"
```

The release's `.env` and `data/` link to the persistent files. For a source-based
installation, run from its checkout and use its own Compose project and data
directory. See the [deployment guide](docs/DEPLOYMENT.md) before changing an
existing installation.

Schedule downtime: the API must stay stopped while its database is copied and
imported. Have Python 3.14+, `uv`, the matching application code and the workbook
available on the server. Create the template before stopping the API. On an
existing deployment, stop the API and back up its databases before updating the
application code, which Compose mounts into the running API.
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
  "/path/to/history.xlsx" --database ./data/miootz.db \
  --template-id 42 --kickoff 19:00 --timezone Europe/London \
  --recorded-by 'Player Name'
```

Review the warnings and `Stats` comparison before restarting. If they show a
problem, correct the workbook and rerun, or restore the backup while the API
remains stopped. After review, restart the API and apply any `.env` changes:

```bash
docker compose --env-file .env -f docker-compose.yml up -d --no-deps api
```

## License

MIT — see [LICENSE](LICENSE).
