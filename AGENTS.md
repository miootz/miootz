# Agent Instructions: Miootz

Miootz is a self-hostable meetup/sports-league scheduler: FastAPI backend +
React SPA frontend, authenticated by Pocket ID (OIDC, passkey-only), served
behind Traefik with Web Push notifications.

## Architecture

- **Backend**: FastAPI application located in `app/`.
  - Entrypoint: `app/api/main.py`
  - Database: SQLite (async via `aiosqlite`) with SQLAlchemy.
  - Auth: `PocketIdAuthMiddleware` validates Pocket ID JWT tokens from the
    `Authorization: Bearer` header. **Default-deny**: every route returns
    `401` unless a valid token resolves a user, except a small explicit
    allowlist in `app/api/middleware.py` (`/health`, `/docs`,
    `/openapi.json`, `/redoc`, and the `/meetups/plus-one/` guest-claim
    preview). Some live event streams accept the access token as a query
    parameter because the browser's EventSource cannot send headers.
  - JWT validation: `app/services/pocket_id_jwt.py` (RS256, JWKS caching).
  - Pocket ID admin client: `app/services/pocket_id_client.py` (static API
    key auth for signup tokens and SSO directory reads).
- **Frontend**: React + TypeScript + Vite located in `frontend/`.
  - Auth: OIDC authorization code flow with Pocket ID (PKCE S256).
  - OIDC client: `frontend/src/auth/pocketIdOidc.ts`.
  - Tokens stored in memory (React AuthContext state); access/refresh tokens
    persisted in `localStorage` (`miootz_tokens`) to survive reloads/restarts.
    PKCE verifier + OIDC state use `sessionStorage`. Trade-off:
    `localStorage` tokens are readable by any XSS — acceptable for this
    internal app, revisit if the threat model changes.
  - Most API requests include `Authorization: Bearer <accessToken>` via
    `apiFetch()` / `useApiFetch()`; EventSource uses a query token instead.
- **Infrastructure**: Dockerized setup with Traefik and Pocket ID
  (passkey-only OIDC). There is **no forward-auth proxy** — Pocket ID is the
  OIDC issuer and the API validates its own bearer tokens.
  - Hosts are **parameterized**: compose interpolates `${AUTH_DOMAIN}`,
    `${API_DOMAIN}` and `${APP_DOMAIN}` from `.env` (prod) or `.env.dev`
    (local dev). Do not hard-code hostnames in compose files.
  - Invite flow: admin creates a signup token via the Pocket ID admin API →
    that returns a Pocket ID signup link.
  - Notifications are **Web Push (VAPID) only** — this stack sends no email.
    `VAPID_SUBJECT` is the VAPID-spec contact URI (`mailto:`), not SMTP
    config.

## Developer Commands

### Backend (Python — 3.14, managed by uv)

- **Install deps**: `uv sync`
- **Run API**: `uv run uvicorn app.api.main:app --reload`
- **Test**: `uv run pytest` (asyncio auto-mode enabled via `pyproject.toml`)
- **Create an admin**: create an account in Pocket ID via `/login/setup`, then
  run `./scripts/bootstrap.sh --add-to-admins <username>` (add `--dev` for the
  development stack).

### Frontend (TS/React)

- **Dev Server**: `cd frontend && npm run dev`
- **Build**: `cd frontend && npm run build`
- **Lint**: `cd frontend && npm run lint`
- **Test**: `cd frontend && npm run test`

## Conventions & Quirks

- **First run**: `cp .env.example .env` (prod) or `cp .env.dev.example .env.dev`
  (dev) **before** `docker compose up` — Compose interpolates every `${...}`,
  including Traefik `Host()` rules, from that env file only. Service-level
  `env_file:` entries do not feed interpolation.
- **Database Initialization**: Tables are created automatically on startup in
  `app/api/main.py`.
- **Auth State**: `PocketIdAuthMiddleware` sets `request.state.user`,
  `request.state.is_admin` (from cached Pocket ID `admins` group membership or
  `User.is_admin`) and `request.state.auth_groups`.
- **JIT Provisioning**: For a valid Pocket ID token, middleware looks up the
  linked subject, then tries to link an existing user through an invite, then
  creates a user if Pocket ID reports membership in at least one group.
- **Local dev stack**: `./scripts/bootstrap.sh --dev` brings up Traefik
  (:8443 HTTPS with mkcert), Pocket ID, API and frontend; add
  `auth|api|app.miootz.local` → `127.0.0.1` in `/etc/hosts`.
- **CORS / Host**: Optional `CORS_ORIGINS` and `TRUSTED_HOSTS`
  (comma-separated) in `.env` for browser clients and Host validation.
- **Data Storage**: SQLite databases live in `data/` (gitignored). Avatars are
  proxied from Pocket ID — there are no local avatar uploads (the crop
  pipeline was removed).
- **Public fixtures**: Use fictional accounts, venues, and schedules. Keep
  real workbooks, fixture inputs, database copies, and CSV exports outside
  version control.
- **Release workflows**: `.github/workflows/ci.yml` runs tests and the frontend
  build. The demo deploys from a stable GitHub release. Production is launched
  manually for a release tag. Both deploy over SSH with Docker Compose.
- **Settings**: `app/core/config.py` uses `extra='ignore'` to tolerate stale
  env vars in `.env`.
- **Licenses**: MIT (see `LICENSE`); no per-file license headers.

## Key Files

| File | Purpose |
| ------ | --------- |
| `app/api/middleware.py` | `PocketIdAuthMiddleware` — JWT validation, user resolution, JIT provisioning, public-path allowlist |
| `app/services/pocket_id_jwt.py` | RS256 JWT validation, JWKS fetch + caching |
| `app/services/pocket_id_client.py` | Pocket ID admin API client (signup tokens, SSO directory) |
| `app/api/invites.py` | Invite CRUD (proxies to Pocket ID signup token API) |
| `app/api/data_export.py` | Admin-only raw data CSV archive |
| `scripts/import_team_maker.py` | Rerunnable import using operator-supplied workbook and template |
| `app/core/config.py` | Settings (Pocket ID OIDC + admin API config) |
| `frontend/src/auth/pocketIdOidc.ts` | PKCE S256 OIDC client (authorize, token exchange, refresh, logout) |
| `frontend/src/auth/AuthProvider.tsx` | Auth context, session restore, token management |
| `frontend/src/auth/RequireAuth.tsx` | Protected route guard → redirect to Pocket ID login |
| `frontend/src/api/client.ts` | API fetch with auto Bearer token injection |

## Documentation

- `INITIAL_SETUP.md` — single setup chain (bootstrap script recommended, manual steps appendix).
- `docs/DEPLOYMENT.md` — release deployment and operations.
- `docs/DEMO.md` — demo data and scenario walkthroughs.
- `docs/SEASONS.md` — season and ranking calculation rules.
- `CONTRIBUTING.md` — dev setup, style, PR flow, commit conventions.
- `SECURITY.md` — reporting channel and scope.
