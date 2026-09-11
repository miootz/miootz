# Miootz

## Quick Start

Bootstrap the full stack (Pocket ID + API + Frontend) in one command:

```bash
./scripts/bootstrap.sh --dev --admin-username yourname
```

See [INITIAL_SETUP.md](INITIAL_SETUP.md) for details.

## Showcase demo

Run `.venv/bin/python -m app.demo --scenario full`, then open
[the local demo menu](http://127.0.0.1:5180/api/demo). This uses fictional data in
a temporary database and requires no passkey. See [the demo guide](docs/DEMO.md)
for scenarios, account switching, screenshot routes, and integration limits.

## Development Setup (Local)

### Backend

1. Install dependencies (ensure you have Python 3.11+ installed).
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

To run the full infrastructure stack locally (including Traefik, Pocket ID, and Mailhog):

```bash
docker-compose -f docker-compose.dev.yml up -d
```

- **Mailhog Web UI**: `http://mail.miootz.local` or `http://localhost:8025`
- **SMTP Server**: `localhost:1025`
- **Pocket ID**: `https://auth.miootz.local:8443`

The project is dockerized. Configuration for Traefik can be found in the `docker/` directory.

### Create an admin (database only)

Run the CLI **inside the API container** so it uses the same `DATABASE_URL` as the running stack:

```bash
docker-compose -f docker-compose.dev.yml exec api \
  uv run python -m app.cli --username <uid> --email <email> [--display-name "Full Name"]
```

This creates a database user with `is_admin=True`. To grant admin access in Pocket ID, visit `https://auth.miootz.local:8443/login/setup` to create your admin account, then add yourself to the `admins` group in the Pocket ID admin UI.

### Demo data (members, past sessions, ratings)

Seeds **20** demo users (`demo_m01` … `demo_m20`, emails `*@demo-bootstrap.local`), **5** past sessions at locations `Demo Field #1` … `#5`, **10–15** random confirmed attendees per session, and sparse **random peer ratings** (1–5). Recalculates `calculated_skill` from peer averages.

Run against the same database as the API (host or container):

```bash
uv run python -m app.bootstrap_data
```

Re-run after wiping demo rows only:

```bash
uv run python -m app.bootstrap_data --force
```

With Docker (from the project root), start the dev stack if it is not already running, then seed inside the `api` container so `DATABASE_URL` matches the API:

```bash
docker-compose -f docker-compose.dev.yml up -d
docker-compose -f docker-compose.dev.yml exec api uv run python -m app.bootstrap_data
```

Wipe prior demo rows and seed again:

```bash
docker-compose -f docker-compose.dev.yml exec api uv run python -m app.bootstrap_data --force
```

If you use Docker Compose V2 (`docker compose` plugin), use the same flags and service name:

```bash
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml exec api uv run python -m app.bootstrap_data
```

Past sessions use `start_time` in the past so they show on the member **History** tab. Demo users are DB-only (no Pocket ID); sign in as a real user to browse history.