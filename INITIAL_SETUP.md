# Initial Setup

This guide walks you through bootstrapping Miootz from scratch.

You have two options: **automated** (recommended) or **manual**.

---

## Option A: Automated Bootstrap (Recommended)

Two quick commands configure everything — Pocket ID groups, OIDC client, API key, and `.env`.

### 1. Prerequisites

- **Docker** and **Docker Compose** installed
- **Python 3.12+** and **uv** installed (for the bootstrap script)
- **`/etc/hosts`** entries (dev only):
  ```
  127.0.0.1 app.miootz.local api.miootz.local auth.miootz.local
  ```

### 2. Run the bootstrap script

```bash
# Development (self-signed TLS on port 8443)
./scripts/bootstrap.sh --dev

# Production (ACME TLS on port 443)
./scripts/bootstrap.sh
```

This generates keys, starts Pocket ID, creates groups, OIDC client, and API key, updates `.env`, and starts the full stack.

### 3. Create your admin account

The bootstrap script configures Pocket ID's infrastructure but **cannot create your passkey** — passkeys require browser interaction (WebAuthn).

1. Visit the setup URL printed by the script:
   ```
   https://auth.miootz.local/login/setup        # prod
   https://auth.miootz.local:8443/login/setup   # dev
   ```
2. Create your account and register a passkey
3. This makes you a Pocket ID admin (auto-granted via `/login/setup`)

### 4. Assign yourself to the `admins` group

Re-run the bootstrap with your username:

```bash
./scripts/bootstrap.sh --dev --add-to-admins yourname
```

This finds your Pocket ID account and adds it to the `admins` group. The `admins` group membership is what grants you admin privileges in the Miootz app (via JWT `groups` claim).

### 5. (Optional) Create demo user accounts

To create Pocket ID accounts for the fictional demo players from `app/bootstrap_data.py`:

```bash
./scripts/bootstrap.sh --dev --demo-users
```

> **Note**: These users have no passkey and can't log in. They exist only so group membership, JWT claims, and data relationships can be tested without creating real accounts.

### What the script does

| Step | Endpoint | Idempotent? |
|------|----------|-------------|
| Generate keys | local | ✅ Skips if set |
| Create `members` group | `POST /api/user-groups` | ✅ Skips if exists |
| Create `admins` group | `POST /api/user-groups` | ✅ Skips if exists |
| Create `miootz-app` OIDC client | `POST /api/oidc/clients` | ✅ Skips if exists |
| Create `miootz-backend` API key | `POST /api/api-keys` | ⚠️ Warns if exists (token not retrievable) |
| Add user to admins group | `PUT /api/users/:id/user-groups` | ✅ Skips if already member |
| Create demo users (optional) | `POST /api/users` | ✅ Skips if exists |

### Why the admin account isn't created automatically

Pocket ID passkeys use WebAuthn, which requires browser interaction (fingerprint, face ID, or device PIN). There's no API to create passkeys. The `/login/setup` endpoint is Pocket ID's built-in first-admin flow that handles account creation **and** passkey registration in one step.

The bootstrap uses `STATIC_API_KEY` to access Pocket ID's admin API, but this creates a phantom "Static API User" that can't log in (no passkey). The setup check explicitly excludes this phantom user, so `/login/setup` remains available for you to create your real account.

> **Note**: The `POCKET_ID_STATIC_API_KEY` is only needed for bootstrap. After setup, Pocket ID uses the `miootz-backend` API key (`POCKET_ID_API_KEY`) for invite creation. You can remove `POCKET_ID_STATIC_API_KEY` from `.env` after initial setup if desired.

---

## Option B: Manual Setup

Follow these steps if you prefer to configure Pocket ID through the web UI.

### 1. Start Pocket ID

```bash
# Dev
docker compose -f docker-compose.dev.yml up -d pocket-id

# Prod
docker compose up -d pocket-id
```

Wait a few seconds, then visit the Pocket ID URL.

### 2. Create Admin Account

Visit `https://auth.miootz.local/login/setup` (or `:8443` for dev).

Create your admin account and register a passkey. This is the first (and only) way to create an admin — there's no fallback password login.

### 3. Create User Groups

In Pocket ID admin UI → **Groups**:

1. Create `members` group → note the UUID
2. Create `admins` group → note the UUID
3. Set `POCKET_ID_MEMBERS_GROUP_ID` in `.env` to the `members` group UUID

### 4. Create OIDC Client

In Pocket ID admin UI → **OIDC Clients**:

| Setting | Value |
|---------|-------|
| Client name | Miootz |
| Client ID | `miootz-app` |
| Is Public | **true** (PKCE required) |
| Redirect URIs | `http://localhost:5173/auth/callback` (dev) |
| | `https://app.miootz.local/auth/callback` (prod) |
| Grant types | `authorization_code`, `refresh_token` |
| PKCE | S256 (required for public clients) |
| Scopes | `openid`, `email`, `profile`, `groups` |

### 5. Create API Key

In Pocket ID admin UI → **Settings** → **API Keys**:

1. Create key named "miootz-backend"
2. Copy key → `.env` as `POCKET_ID_API_KEY`
3. Used by backend for `POST /api/signup-tokens` (invite creation)

### 6. Set Environment Variables

```bash
cp .env.example .env
```

Fill in the following in `.env`:

```env
SECRET_KEY=<generate: python -c "import secrets; print(secrets.token_urlsafe(32))">
ENCRYPTION_KEY=<generate: python -c "import secrets; print(secrets.token_hex(32))">
POCKET_ID_OIDC_ISSUER=https://auth.miootz.local
POCKET_ID_OIDC_CLIENT_ID=miootz-app
POCKET_ID_API_KEY=<from step 5>
POCKET_ID_MEMBERS_GROUP_ID=<from step 3>
```

### 7. Add Self to Admins Group

In Pocket ID admin UI → **Users** → your account → add to `admins` group.

Alternatively, promote via DB CLI:

```bash
uv run python -m app.cli --username <your-username>
```

### 8. Start Full Stack

```bash
# Dev
docker compose -f docker-compose.dev.yml up -d

# Prod
docker compose up -d
```

---

## Adding Miootz-App Users

After initial setup, new users join via **invites**:

1. Visit `https://app.miootz.local/admin/invites`
2. Create invite → copy the Pocket ID signup link
3. Send the link to the invitee (email, SMS, etc.)
4. The invitee opens the link, creates a passkey, and is auto-assigned to `members`

The invite link is a Pocket ID signup URL: `https://auth.miootz.local/st/<token>`.

---

## Demo Users

The `app/bootstrap_data.py` script creates 20 fictional DB users named after famous footballers (Demo Player 03, Messi, etc.) with synthetic `pocket_id_sub` UUIDs, past game sessions, attendance records, and peer ratings.

```bash
# Run locally
uv run python -m app.bootstrap_data

# Run in Docker
docker compose -f docker-compose.dev.yml exec api uv run python -m app.bootstrap_data

# Re-run (purge demo data first)
uv run python -m app.bootstrap_data --force
```

These users are **DB-only** — they have no Pocket ID accounts and can't log in. They exist to populate the app with realistic data for testing and demo purposes.

To also create corresponding Pocket ID accounts (still no passkey, for testing group membership and JWT claims):

```bash
./scripts/bootstrap.sh --dev --demo-users
```

---

## Environment Variables Reference

| Variable | Purpose | Auto-generated? |
|----------|---------|-----------------|
| `SECRET_KEY` | Symmetric signing key for action tokens | ✅ by bootstrap |
| `ENCRYPTION_KEY` | Pocket ID data encryption | ✅ by bootstrap |
| `POCKET_ID_STATIC_API_KEY` | Admin API key for bootstrap only | ✅ by bootstrap |
| `POCKET_ID_API_KEY` | Backend API key for invite system | ✅ by bootstrap (first run) |
| `POCKET_ID_MEMBERS_GROUP_ID` | Group UUID for new signups | ✅ by bootstrap |
| `POCKET_ID_OIDC_ISSUER` | Pocket ID OIDC issuer URL | ✅ by bootstrap |
| `POCKET_ID_OIDC_CLIENT_ID` | OIDC client ID | Fixed: `miootz-app` |
| `POCKET_ID_INTERNAL_URL` | Internal Pocket ID URL | Fixed in compose |
| `POCKET_ID_APP_URL` | Public Pocket ID URL | ✅ by bootstrap |

---

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

Pocket ID doesn't expose existing API key tokens via the API. If you re-run the bootstrap script and the `miootz-backend` key already exists, the script warns you to verify `POCKET_ID_API_KEY` in `.env` is correct.

### /login/setup is not available

The setup endpoint is only available when no real users exist. If it's gone, another user was already created. Create a signup token via the Pocket ID admin UI instead, or use the API directly.

### "JWT does not have 3 segments"

The `Authorization` header must be `Bearer <jwt>`. Check the token format.

### "No matching JWK found"

Pocket ID's JWKS endpoint is unreachable. Check `POCKET_ID_OIDC_ISSUER` and network connectivity.
