# Agent Instructions: Footy Legends

## Architecture

- **Backend**: FastAPI application located in `app/`. 
  - Entrypoint: `app/api/main.py`
  - Database: SQLite (async via `aiosqlite`) with SQLAlchemy.
  - Auth: Uses `AutheliaAuthMiddleware` for authentication.
- **Frontend**: React + TypeScript + Vite located in `frontend/`.
- **Infrastructure**: Dockerized setup with Traefik, Authelia (LDAP via OpenLDAP). Invites use `POST /invites/verify/begin` then `POST /invites/verify/complete` (password on the confirmation page); the API sets LDAP `userPassword`, calls Authelia `POST /api/firstfactor` via `AUTHELIA_INTERNAL_URL`, and forwards `Set-Cookie` to the browser. `docker/authelia/config.yml` must **bypass** `/api/invites/verify/` (and `/invites/verify/` on the API host) so unauthenticated clients can register. **Authelia branding** (logo, favicon, English copy) lives in `docker/authelia/branding/` via `server.asset_path`; replace `logo.png` with a transparent PNG from design when ready. Browser push uses Web Push (VAPID) from the API, not a separate notify service.

## Developer Commands

### Backend (Python)

- **Run API**: `uv run uvicorn app.api.main:app --reload`
- **Test**: `uv run pytest` (async mode enabled via `pyproject.toml`)
- **Create admin (DB + OpenLDAP)**: `uv run python -m app.cli --username <uid> --email <mail>` (requires `LDAP_URI`, `LDAP_BASE_DN`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD` in `.env`). Use `--skip-ldap` if the LDAP user already exists (e.g. bootstrap `uid=admin`). Optional `--display-name`.

### Frontend (TS/React)

- **Dev Server**: `cd frontend && npm run dev`
- **Build**: `cd frontend && npm run build`
- **Lint**: `cd frontend && npm run lint`
- **Test**: `cd frontend && npm run test`

## Conventions & Quirks

- **Database Initialization**: Tables are automatically created on startup in `app/api/main.py`.
- **Auth State**: `AutheliaAuthMiddleware` sets `request.state.user`, `request.state.is_admin` (DB **or** Authelia `Remote-Groups` per `AUTH_ADMIN_GROUPS`), and `request.state.auth_groups`.
- **Production (Docker + Traefik)**: API is protected with Traefik **forward-auth** to Authelia (`footy-auth` middleware in `docker-compose*.yml`). Set `AUTH_REQUIRE_FORWARDED_HEADERS=true` (set in compose) so `Remote-User` is ignored unless `X-Forwarded-For` / `Forwarded` is present (spoof protection on direct access).
- **Local `uvicorn`**: Keep `AUTH_REQUIRE_FORWARDED_HEADERS=false` (default) and send `Remote-User` for tests/dev, or add `X-Forwarded-For: 127.0.0.1` when testing strict mode.
- **CORS / Host**: Optional `CORS_ORIGINS` and `TRUSTED_HOSTS` (comma-separated) in `.env` for browser clients and Host validation.
- **Data Storage**: SQLite databases and uploads are stored in the `data/` directory.