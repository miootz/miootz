# Initial Setup

This guide walks you through bootstrapping Miootz from scratch. It is the single
setup chain for this repo — start here.

You have two options: **Option A — automated bootstrap** (recommended) or
**Option B — manual setup** (appendix, for configuring Pocket ID through its web UI
yourself).

## Hosts and `.env` (read first)

The stack is served on three hosts. All three names come from `.env` and are shown
throughout this guide as:

| Placeholder | `.env` key | Serves |
|-----------|------------|--------|
| `${APP_DOMAIN}` | `APP_DOMAIN` | Frontend (+ same-origin `/api` via nginx/Traefik) |
| `${API_DOMAIN}` | `API_DOMAIN` | API (HTTPS only; plain `http://` gets a 301 redirect) |
| `${AUTH_DOMAIN}` | `AUTH_DOMAIN` | Pocket ID (passkey OIDC) |

Pick a domain you control (e.g. `miootz.example`). For **local development**, make
the three names resolve to the machine running Docker by adding entries to
`/etc/hosts` (or your DNS):

```
127.0.0.1 app.<your-domain> api.<your-domain> auth.<your-domain>
```

`.env` (prod) and `.env.dev` (dev stack) **must exist before `docker compose up`** —
create them from the examples:

```bash
cp .env.example .env            # used by docker-compose.yml
cp .env.dev.example .env.dev    # used by docker-compose.dev.yml
```

Then replace the placeholder values inside (secrets, group UUIDs, etc.), or let
`scripts/bootstrap.sh` generate and fill them for you (Option A).

---

## Option A: Automated Bootstrap (Recommended)

Two quick commands configure everything — Pocket ID groups, OIDC client, API key,
and `.env`.

### 1. Prerequisites

- **Docker** and **Docker Compose** installed
- **Python 3.14+** and **uv** installed (for the bootstrap script)
- `.env` / `.env.dev` present (created from the `.example` files above)
- Hostname resolution for `app` / `api` / `auth` (local: `/etc/hosts` entries shown
  above; public: DNS records for your domain)

### 2. Run the bootstrap script

```bash
# Development (self-signed TLS on port 8443)
./scripts/bootstrap.sh --dev

# Production (ACME TLS on port 443)
./scripts/bootstrap.sh
```

This generates keys, starts Pocket ID, creates groups, OIDC client, and API key,
updates `.env`, and starts the full stack.

### 3. Create your admin account

The bootstrap script configures Pocket ID's infrastructure but **cannot create your
passkey** — passkeys require browser interaction (WebAuthn).

1. Visit the setup URL printed by the script:
   - Dev: `https://${AUTH_DOMAIN}:8443/login/setup`
   - Prod: `https://${AUTH_DOMAIN}/login/setup`
2. Create your account and register a passkey
3. This makes you a Pocket ID admin (auto-granted via `/login/setup`)

### 4. Assign yourself to the `admins` group

Re-run the bootstrap with your username:

```bash
./scripts/bootstrap.sh --dev --add-to-admins yourname
```

This finds your Pocket ID account and adds it to the `admins` group. The `admins`
group membership is what grants you admin privileges in the Miootz app (via JWT
`groups` claim).

### What the script does

| Step | Endpoint | Idempotent? |
|------|----------|-------------|
| Generate keys | local | ✅ Skips if set |
| Create `members` group | `POST /api/user-groups` | ✅ Skips if exists |
| Create `admins` group | `POST /api/user-groups` | ✅ Skips if exists |
| Create `miootz-app` OIDC client | `POST /api/oidc/clients` | ✅ Skips if exists |
| Create `miootz-backend` API key | `POST /api/api-keys` | ⚠️ Warns if exists (token not retrievable) |
| Add user to admins group | `PUT /api/users/:id/user-groups` | ✅ Skips if already member |

### Why the admin account isn't created automatically

Pocket ID passkeys use WebAuthn, which requires browser interaction (fingerprint,
face ID, or device PIN). There's no API to create passkeys. The `/login/setup`
endpoint is Pocket ID's built-in first-admin flow that handles account creation
**and** passkey registration in one step.

The bootstrap uses `STATIC_API_KEY` to access Pocket ID's admin API, but this
creates a phantom "Static API User" that can't log in (no passkey). The setup check
explicitly excludes this phantom user, so `/login/setup` remains available for you to
create your real account.

> **Note**: The `POCKET_ID_STATIC_API_KEY` is only needed for bootstrap. After
> setup, Pocket ID uses the `miootz-backend` API key (`POCKET_ID_API_KEY`) for
> invite creation. You can remove `POCKET_ID_STATIC_API_KEY` from `.env` after
> initial setup if desired.

### Customize Pocket ID branding (optional)

In the Pocket ID admin UI you can upload a custom favicon and toggle the dark/light
theme. App name and logo are not fully customizable without forking Pocket ID's
frontend (Svelte). The invite link points to Pocket ID's signup page, which shows
"Pocket ID" branding — visible only during the one-time signup flow.

---

## Option B: Manual Setup (Appendix)

Follow these steps if you prefer to configure Pocket ID through the web UI.

### 1. Create `.env` (required before `docker compose up`)

```bash
cp .env.example .env            # prod
cp .env.dev.example .env.dev    # if you also use the dev stack
```

Fill in the required values in `.env`:

```env
SECRET_KEY=<generate: python -c "import secrets; print(secrets.token_urlsafe(32))">
ENCRYPTION_KEY=<generate: python -c "import secrets; print(secrets.token_hex(32))">
APP_DOMAIN=app.<your-domain>
API_DOMAIN=api.<your-domain>
AUTH_DOMAIN=auth.<your-domain>
POCKET_ID_OIDC_ISSUER=https://${AUTH_DOMAIN}
POCKET_ID_OIDC_CLIENT_ID=miootz-app
POCKET_ID_API_KEY=<from step 5>
POCKET_ID_MEMBERS_GROUP_ID=<from step 3>
```

Ensure the three hostnames resolve (local: `/etc/hosts` entry pointing
`app`/`api`/`auth` at `127.0.0.1`; public: DNS).

### 2. Start Pocket ID

```bash
# Dev
docker compose -f docker-compose.dev.yml up -d pocket-id

# Prod
docker compose up -d pocket-id
```

Wait a few seconds, then visit `https://${AUTH_DOMAIN}` (dev: add `:8443`).

### 3. Create Admin Account

Visit `https://${AUTH_DOMAIN}/login/setup` (dev: `:8443`).

Create your admin account and register a passkey. This is the first (and only) way
to create an admin — there's no fallback password login.

### 4. Create User Groups

In Pocket ID admin UI → **Groups**:

1. Create `members` group → note the UUID
2. Create `admins` group → note the UUID
3. Set `POCKET_ID_MEMBERS_GROUP_ID` in `.env` to the `members` group UUID

New signup tokens auto-assign users to the `members` group. Admin status is assigned
manually (or via DB CLI).

### 5. Create OIDC Client

In Pocket ID admin UI → **OIDC Clients**:

| Setting | Value |
|---------|-------|
| Client name | Miootz |
| Client ID | `miootz-app` |
| Is Public | **true** (PKCE required) |
| Redirect URIs | `http://localhost:5173/auth/callback` (Vite dev) |
| | `https://${APP_DOMAIN}/auth/callback` (Docker) |
| Grant types | `authorization_code`, `refresh_token` |
| PKCE | S256 (required for public clients) |
| Scopes | `openid`, `email`, `profile`, `groups` |

### 6. Create API Key

In Pocket ID admin UI → **Settings** → **API Keys**:

1. Create key named "miootz-backend"
2. Copy key → `.env` as `POCKET_ID_API_KEY`
3. Used by backend for `POST /api/signup-tokens` (invite creation)

### 7. Add Self to Admins Group

In Pocket ID admin UI → **Users** → your account → add to `admins` group.

Alternatively, promote via DB CLI:

```bash
uv run python -m app.cli --username <your-username>
```

### 8. Start Full Stack

```bash
# Dev (requires .env.dev to exist)
docker compose -f docker-compose.dev.yml up -d

# Prod (requires .env to exist)
docker compose up -d
```

---

## Adding Miootz-App Users

After initial setup, new users join via **invites**:

1. Visit `https://${APP_DOMAIN}/admin/invites`
2. Create invite → copy the Pocket ID signup link
3. Send the link to the invitee (out-of-band: messenger, email you send yourself, etc.)
4. The invitee opens the link, creates a passkey, and is auto-assigned to `members`

The invite link is a Pocket ID signup URL: `https://${AUTH_DOMAIN}/st/<token>`.

## Demo data

The showcase runner (`app/demo.py`) seeds a self-contained demo — 20 fictional
members, an upcoming meetup, and past meetups with matches, goals and ratings —
into a temporary database, with demo accounts to sign in as:

```bash
uv run python -m app.demo --scenario full
```

See `docs/DEMO.md` for the scenarios and `docs/SHOWCASE.md` for recording the
demo site.

## Local Development Ports

| Component | URL | Notes |
|-----------|-----|-------|
| API (uvicorn) | `http://localhost:8000` | No auth middleware — open; real requests use `Authorization: Bearer <JWT>` |
| Frontend (Vite) | `http://localhost:5173` | Proxies `/api` → `localhost:8000`; OIDC needs Pocket ID running in Docker |
| Docker dev stack | `https://${APP_DOMAIN}:8443` | Self-signed TLS; needs hosts → `127.0.0.1` and `.env.dev` |

Notifications are **Web Push only** (VAPID). There is no mail delivery in this stack.

## Environment Variables Reference

| Variable | Purpose | Auto-generated? |
|----------|---------|-----------------|
| `SECRET_KEY` | Symmetric signing key for action tokens | ✅ by bootstrap |
| `ENCRYPTION_KEY` | Pocket ID data encryption | ✅ by bootstrap |
| `APP_DOMAIN` / `API_DOMAIN` / `AUTH_DOMAIN` | Hostnames used by Traefik and the frontend | Set in `.env` (from your domain) |
| `POCKET_ID_STATIC_API_KEY` | Admin API key for bootstrap only | ✅ by bootstrap |
| `POCKET_ID_API_KEY` | Backend API key for invite system | ✅ by bootstrap (first run) |
| `POCKET_ID_MEMBERS_GROUP_ID` | Group UUID for new signups | ✅ by bootstrap |
| `POCKET_ID_OIDC_ISSUER` | Pocket ID OIDC issuer URL | ✅ by bootstrap |
| `POCKET_ID_OIDC_CLIENT_ID` | OIDC client ID | Fixed: `miootz-app` |
| `POCKET_ID_INTERNAL_URL` | Internal Pocket ID URL | Fixed in compose |
| `POCKET_ID_APP_URL` | Public Pocket ID URL | ✅ by bootstrap |
| `CORS_ORIGINS` | Allowed browser origins (leave empty for same-origin demo) | Optional, set in `.env` |
| `TRUSTED_HOSTS` | Hosts accepted by the API | Optional, set in `.env` |
| `PUBLIC_APP_URL` | Public app URL used in links | Optional, set in `.env` |

## Troubleshooting

### "POCKET_ID_STATIC_API_KEY is not set"

The bootstrap script requires this key. Either:

- Run `./scripts/bootstrap.sh` (generates it automatically)
- Set it manually: `export POCKET_ID_STATIC_API_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")`

### "Pocket ID did not become ready within 60s"

Check that Docker is running and the Pocket ID container is healthy:

```bash
docker ps | grep pocket_id
docker logs pocket_id
```

### API key token not retrievable on re-run

Pocket ID doesn't expose existing API key tokens via the API. If you re-run the
bootstrap script and the `miootz-backend` key already exists, the script warns you to
verify `POCKET_ID_API_KEY` in `.env` is correct.

### /login/setup is not available

The setup endpoint is only available when no real users exist. If it's gone, another
user was already created. Create a signup token via the Pocket ID admin UI instead,
or use the API directly.

### "JWT does not have 3 segments"

The `Authorization` header must be `Bearer <jwt>`. Check the token format.

### "No matching JWK found"

Pocket ID's JWKS endpoint is unreachable. Check `POCKET_ID_OIDC_ISSUER` and network
connectivity.

### "UNIQUE constraint failed: users.username"

JIT provisioning created a user from a JWT before your code could. Ensure
email/username consistency.

### Frontend can't reach Pocket ID

Check that `auth.<your-domain>` resolves and the Pocket ID container is running
(`docker ps`).

### Invite creation fails (502)

`POCKET_ID_API_KEY` is missing or invalid. Check `.env` and the Pocket ID admin UI.
