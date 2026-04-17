# Footy Legends

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

To run the full infrastructure stack locally (including Traefik, Authelia, and Mailhog):

```bash
docker-compose -f docker-compose.dev.yml up -d
```

- **Mailhog Web UI**: `http://mail.footylegends.local` or `http://localhost:8025`
- **SMTP Server**: `localhost:1025`

The project is dockerized. Configuration for Traefik and Authelia can be found in the `docker/` directory.

### Create an admin (OpenLDAP + database)

Run the CLI **inside the API container** so it uses the same `DATABASE_URL` and `LDAP_URI=ldap://openldap:389` as the running stack:

```bash
docker-compose -f docker-compose.dev.yml exec api \
  uv run python -m app.cli --username <uid> --email <email> [--display-name "Full Name"]
```

If the LDAP user already exists (for example the bootstrap `uid=admin` from `docker/openldap/bootstrap/`), add `--skip-ldap` to only create or update the database row:

```bash
docker-compose -f docker-compose.dev.yml exec api \
  uv run python -m app.cli --username admin --email admin@footylegends.local --skip-ldap
```

When LDAP is provisioned by the CLI, the temporary password is printed once; sign in through Authelia and change the password there.

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

Past sessions use `start_time` in the past so they show on the member **History** tab. Demo users are DB-only (no LDAP); sign in as a real user to browse history, or add matching LDAP entries if you need SSO for `demo_m01`, etc.