# Contributing to Miootz

Thanks for your interest! Miootz is a self-hostable meetup scheduler:
FastAPI backend + React/Vite frontend + Docker Compose with Traefik and
Pocket ID (passkey-only OIDC). Push notifications use Web Push (VAPID) —
there is no mail server in this stack.

## Development Setup

**Don't duplicate the setup docs — read
[`INITIAL_SETUP.md`](./INITIAL_SETUP.md) first.** It covers hosts, `.env`
files, Pocket ID bootstrap, and starting the stack. Key points it already
explains in full:

- Compose interpolation needs the env files to exist **before**
  `docker compose up` (`cp .env.example .env`, and `cp .env.dev.example
  .env.dev` for dev).
- Hostnames are parameterized as `${AUTH_DOMAIN}` / `${API_DOMAIN}` /
  `${APP_DOMAIN}` from those env files.

## Toolchain Versions

| Tool | Version | Notes |
| --- | --- | --- |
| Python | 3.14+ | `.python-version` pins `3.14`; managed with [`uv`](https://docs.astral.sh/uv/) |
| Node.js | 22+ | Used by the frontend and CI |
| Docker + Compose | current stable | Runs Traefik + Pocket ID |

## Running the App

```bash
# Backend API (from repo root)
uv sync            # install deps from uv.lock
uv run uvicorn app.api.main:app --reload

# Frontend (from frontend/)
npm ci
npm run dev      # Vite dev server, proxies /api to localhost:8000
```

## Running Tests

```bash
# Backend (pytest, asyncio_mode=auto via pyproject.toml)
uv run pytest

# Frontend (Vitest — single run, non-interactive by default)
cd frontend && npm run test
```

CI runs the backend tests, frontend tests, and a production frontend build.

## Code Style

- **Python**: [`ruff`](https://docs.astral.sh/ruff/) — config in
  `pyproject.toml` (`select = ["F", "E9", "B", "UP"]`, target `py314`).
  Run `uv run ruff check .` (and `uv run ruff format .`) before pushing.
- **Frontend**: ESLint (`cd frontend && npm run lint`), TypeScript
  with the project's tsconfig.

## Branch & Pull Request Flow

1. Branch from `main` (or `master`) — name it after your change,
   e.g. `feat/waitlist-notify`, `fix/push-retry`.
2. Keep PRs small and focused; one logical change per PR.
3. Include tests for behavior changes (backend: pytest under
   `app/tests/`; frontend: Vitest colocated `*.test.ts(x)`).
4. Make sure CI is green: backend tests + frontend tests/build.
5. Wait for review; squash-merge is preferred.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat: add waitlist position to push notification
fix: avoid duplicate signups when tapping a notification twice
docs: clarify Pocket ID bootstrap steps in INITIAL_SETUP
chore: update the dependency lockfile
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` (scopes are
optional, e.g. `fix(push): ...`).

## Secrets & Hostnames — Hard Rules

- **Never commit real secrets.** `.env` / `.env.dev` are gitignored; only
  `.env.example` / `.env.dev.example` are committed, with placeholder
  values (no live keys, no live hostnames).
- **Never write a live hostname** in committed files. Use parameterized
  `${AUTH_DOMAIN}`-style placeholders, or documented local-dev examples
  like `*.miootz.local`. Keep real player data, venue settings, and workbook
  exports outside version control. Use fictional fixtures in tests and demos.

## Lockfiles

Commit and keep lockfiles in sync when dependencies change:

- **Python**: regenerate with `uv lock` (or `uv add <pkg>` /
  `uv remove <pkg>`, which update `uv.lock` automatically). CI installs
  with `uv sync --frozen`.
- **Frontend**: `npm install` (updates `package-lock.json`);
  CI installs with `npm ci`.

Do **not** hand-edit lockfiles.
