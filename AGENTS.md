# Agent Instructions: Miootz

## Architecture

- **Backend**: FastAPI application located in `app/`.
  - Entrypoint: `app/api/main.py`
  - Database: SQLite (async via `aiosqlite`) with SQLAlchemy.
  - Auth: Validates Pocket ID JWT tokens from `Authorization: Bearer` header.
  - JWT validation: `app/services/pocket_id_jwt.py` (RS256, JWKS caching).
  - Pocket ID admin client: `app/services/pocket_id_client.py` (API key auth for signup tokens).
- **Frontend**: React + TypeScript + Vite located in `frontend/`.
  - Auth: OIDC authorization code flow with Pocket ID (PKCE S256).
  - OIDC client: `frontend/src/auth/pocketIdOidc.ts`.
  - Tokens stored in memory (React AuthContext state) + sessionStorage for persistence across reloads.
  - All API requests include `Authorization: Bearer <accessToken>` via `apiFetch()` / `useApiFetch()`.
- **Infrastructure**: Dockerized setup with Traefik and Pocket ID (passkey-only OIDC).
  - No forward-auth proxy — Pocket ID handles authentication directly.
  - Pocket ID routed at `auth.miootz.local`.
  - API and frontend have no auth middleware — open to all (auth handled by Pocket ID tokens).
  - Invite flow: Admin creates signup token via Pocket ID admin API → returns Pocket ID signup link.
  - Browser push uses Web Push (VAPID) from the API.

## Developer Commands

### Backend (Python)

- **Run API**: `uv run uvicorn app.api.main:app --reload`
- **Test**: `uv run pytest` (async mode enabled via `pyproject.toml`)
- **Create admin (DB only)**: `uv run python -m app.cli --username <uid> --email <mail>` (creates DB user with `is_admin=True`). Create admin in Pocket ID via `/login/setup` and link by email.

### Frontend (TS/React)

- **Dev Server**: `cd frontend && npm run dev`
- **Build**: `cd frontend && npm run build`
- **Lint**: `cd frontend && npm run lint`
- **Test**: `cd frontend && npm run test`

## Conventions & Quirks

- **Database Initialization**: Tables are automatically created on startup in `app/api/main.py`.
- **Auth State**: `PocketIdAuthMiddleware` sets `request.state.user`, `request.state.is_admin` (from `"admins" in groups` claim OR `User.is_admin`), and `request.state.auth_groups`.
- **JIT Provisioning**: First valid Pocket ID token for a new user auto-creates a DB row (matched by `pocket_id_sub`, fallback to email).
- **Production (Docker + Traefik)**: No forward-auth middleware. Pocket ID handles auth at `auth.miootz.local`. API validates Pocket ID JWT tokens.
- **Local `uvicorn`**: Frontend OIDC flow works with Pocket ID running in Docker. Vite proxies `/api` to `localhost:8000`.
- **CORS / Host**: Optional `CORS_ORIGINS` and `TRUSTED_HOSTS` (comma-separated) in `.env` for browser clients and Host validation.
- **Data Storage**: SQLite databases and uploads are stored in the `data/` directory.
- **Settings**: `app/core/config.py` uses `extra='ignore'` to tolerate stale env vars in `.env`.

## Key Files

| File | Purpose |
|------|---------|
| `app/api/middleware.py` | `PocketIdAuthMiddleware` — JWT validation, user resolution, JIT provisioning |
| `app/services/pocket_id_jwt.py` | RS256 JWT validation, JWKS fetch + caching |
| `app/services/pocket_id_client.py` | Pocket ID admin API client (signup tokens) |
| `app/api/invites.py` | Invite CRUD (proxies to Pocket ID signup token API) |
| `app/core/config.py` | Settings (Pocket ID OIDC + admin API config) |
| `frontend/src/auth/pocketIdOidc.ts` | PKCE S256 OIDC client (authorize, token exchange, refresh, logout) |
| `frontend/src/auth/AuthProvider.tsx` | Auth context, session restore, token management |
| `frontend/src/auth/RequireAuth.tsx` | Protected route guard → redirect to Pocket ID login |
| `frontend/src/api/client.ts` | API fetch with auto Bearer token injection |
