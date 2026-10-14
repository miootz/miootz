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
    `/openapi.json`, `/redoc`, the `/sessions/plus-one/` guest-claim
    preview, and `GET /sessions/<id>/matches/<id>/goals`, which carry their
    own capability tokens).
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
  - All API requests include `Authorization: Bearer <accessToken>` via
    `apiFetch()` / `useApiFetch()`.
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
- **Showcase site**: `showcase/` is a **separate nested git repository**
  (ignored by this one) — a Next/vinext marketing site with recorded demo
  videos. See `showcase/AGENTS.md` for how to record, encode and deploy it.

## Developer Commands

### Backend (Python — 3.14, managed by uv)

- **Install deps**: `uv sync`
- **Run API**: `uv run uvicorn app.api.main:app --reload`
- **Test**: `uv run pytest` (asyncio auto-mode enabled via `pyproject.toml`)
- **Create admin (DB only)**: `uv run python -m app.cli --username <uid> --email <mail>`
  (creates a DB user with `is_admin=True`). Create the admin in Pocket ID via
  `/login/setup` and link by email.

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
  `request.state.is_admin` (from `"admins" in groups` claim OR `User.is_admin`)
  and `request.state.auth_groups`.
- **JIT Provisioning**: The first valid Pocket ID token for a new user
  auto-creates a DB row (matched by `pocket_id_sub`, falling back to email).
- **Local dev stack**: `./scripts/bootstrap.sh --dev` brings up Traefik
  (:8880 http / :8443 https with mkcert), Pocket ID, API and frontend; add
  `auth|api|app.miootz.local` → `127.0.0.1` in `/etc/hosts`.
- **CORS / Host**: Optional `CORS_ORIGINS` and `TRUSTED_HOSTS`
  (comma-separated) in `.env` for browser clients and Host validation.
- **Data Storage**: SQLite databases live in `data/` (gitignored). Avatars are
  proxied from Pocket ID — there are no local avatar uploads (the crop
  pipeline was removed).
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
| `app/core/config.py` | Settings (Pocket ID OIDC + admin API config) |
| `frontend/src/auth/pocketIdOidc.ts` | PKCE S256 OIDC client (authorize, token exchange, refresh, logout) |
| `frontend/src/auth/AuthProvider.tsx` | Auth context, session restore, token management |
| `frontend/src/auth/RequireAuth.tsx` | Protected route guard → redirect to Pocket ID login |
| `frontend/src/api/client.ts` | API fetch with auto Bearer token injection |

## Documentation

- `INITIAL_SETUP.md` — single setup chain (bootstrap script recommended, manual steps appendix).
- `docs/DEMO.md` — demo data and scenario walkthroughs.
- `docs/SHOWCASE.md` — showcase site guide.
- `docs/demo-deploy-hourly.md` — hourly-reset Cloudflare demo design (**not yet implemented**; kept until it ships).
- `CONTRIBUTING.md` — dev setup, style, PR flow, commit conventions.
- `SECURITY.md` — reporting channel and scope.
