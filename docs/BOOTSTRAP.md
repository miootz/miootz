# Bootstrap Instructions

> **Quick start**: Run `./scripts/bootstrap.sh --dev` to automate Pocket ID infrastructure setup.
> See [INITIAL_SETUP.md](../INITIAL_SETUP.md) for full details.

## Automated Bootstrap

```bash
# Dev (self-signed TLS on port 8443)
./scripts/bootstrap.sh --dev

# Prod (ACME TLS on port 443)
./scripts/bootstrap.sh
```

This creates groups, OIDC client, API key, and updates `.env` — all idempotently.

Then create your admin account:

1. Visit `https://auth.miootz.local/login/setup` (or `:8443` for dev)
2. Create account + register a passkey
3. Re-run: `./scripts/bootstrap.sh --dev --add-to-admins yourname`

---

## Manual Steps (if not using the script)

### 1. Start Pocket ID

```bash
docker compose up -d pocket-id
```

Wait a few seconds for Pocket ID to start, then visit `https://auth.miootz.local`.

### 2. Create Admin Account

Visit `https://auth.miootz.local/login/setup`.

Create your admin account and register a passkey. This is the first (and only) way to create an admin — there's no fallback password login.

### 3. Create User Groups

In Pocket ID admin UI → **Groups**:

1. Create `members` group → note the UUID
2. Create `admins` group → note the UUID
3. Set `POCKET_ID_MEMBERS_GROUP_ID` in `.env` to the `members` group UUID

New signup tokens will auto-assign users to the `members` group. Admin status is assigned manually (or via DB CLI).

### 4. Create OIDC Client for Our App

In Pocket ID admin UI → **OIDC Clients**:

| Setting | Value |
| --------- | ------- |
| Client name | Miootz |
| Client ID | `miootz-app` |
| Is Public | **true** (PKCE required) |
| Redirect URIs | `http://localhost:5173/auth/callback` (dev) |
| | `https://app.miootz.local/auth/callback` (prod) |
| Grant types | `authorization_code`, `refresh_token` |
| PKCE | S256 (required for public clients) |
| Scopes | `openid`, `email`, `profile`, `groups` |

### 5. Create API Key for Backend

In Pocket ID admin UI → **Settings** → **API Keys**:

1. Create key named "miootz-backend"
2. Copy key → `.env` as `POCKET_ID_API_KEY`
3. Used by backend for `POST /api/signup-tokens` (invite creation)

### 6. Customize Branding (optional)

In Pocket ID admin UI:

- Upload custom favicon
- Toggle dark/light theme

**Note**: App name and logo are not fully customizable without forking Pocket ID's frontend (Svelte). The invite link points to Pocket ID's signup page, which shows "Pocket ID" branding. This is visible only during the one-time signup flow.

### 7. Set Environment Variables

Create `.env` in the project root:

```env
# Required
SECRET_KEY=<generate-with: python -c "import secrets; print(secrets.token_urlsafe(32))">

# Pocket ID
POCKET_ID_INTERNAL_URL=http://pocket-id:1411
POCKET_ID_APP_URL=https://auth.miootz.local
POCKET_ID_OIDC_ISSUER=https://auth.miootz.local
POCKET_ID_OIDC_CLIENT_ID=miootz-app
POCKET_ID_API_KEY=<from step 5>
POCKET_ID_MEMBERS_GROUP_ID=<from step 3>

# Optional
CORS_ORIGINS=https://app.miootz.local
TRUSTED_HOSTS=app.miootz.local,api.miootz.local
PUBLIC_APP_URL=https://app.miootz.local
```

### 8. Start Full Stack

```bash
docker compose up -d
```

Services:

- `app.miootz.local` → Frontend + API (via Traefik)
- `api.miootz.local` → API directly (HTTPS only; plain `http://` gets a 301 redirect)
- `auth.miootz.local` → Pocket ID

### 9. Create First Invite

Visit `https://app.miootz.local/admin/invites`.

Create invite → copy Pocket ID link → send out-of-band (email, SMS, etc.).

The invite link is a Pocket ID signup URL: `https://auth.miootz.local/st/<token>`. The invitee opens the link, creates a passkey, and is auto-assigned to the `members` group.

### 10. Add Self to Admins Group

In Pocket ID admin UI → **Users** → your account → add to `admins` group.

Alternatively, promote via DB CLI:

```bash
uv run python -m app.cli --username <your-username>
```

This sets `is_admin=True` in the Miootz DB. Admin status is derived from **either** `"admins" in groups` claim **or** `User.is_admin`.

## Local Development

### Backend only

```bash
uv run uvicorn app.api.main:app --reload
```

API runs on `http://localhost:8000`. No auth middleware — all endpoints open (auth via `Authorization: Bearer <JWT>`).

### Frontend only

```bash
cd frontend && npm run dev
```

Vite dev server on `http://localhost:5173`. Proxies `/api` to `localhost:8000`.

For OIDC to work locally, Pocket ID must be running in Docker (Traefik routes `auth.miootz.local`).

### Full stack (Docker dev)

```bash
docker compose -f docker-compose.dev.yml up -d
```

Uses self-signed TLS on port 8443. Add `miootz.local` to `/etc/hosts`:

```
127.0.0.1 app.miootz.local api.miootz.local auth.miootz.local mail.miootz.local
```

## Troubleshooting

### "JWT does not have 3 segments"

The `Authorization` header must be `Bearer <jwt>`. Check the token format.

### "No matching JWK found"

Pocket ID's JWKS endpoint is unreachable. Check `POCKET_ID_OIDC_ISSUER` and network connectivity.

### "UNIQUE constraint failed: users.username"

JIT provisioning created a user from a JWT before your code could. Ensure email/username consistency.

### Frontend can't reach Pocket ID

Check that `auth.miootz.local` resolves and Pocket ID container is running (`docker ps`).

### Invite creation fails (502)

`POCKET_ID_API_KEY` is missing or invalid. Check `.env` and Pocket ID admin UI.
