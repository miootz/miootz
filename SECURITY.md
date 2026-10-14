# Security Policy

Miootz is a **self-hostable stack** (FastAPI API + React frontend + Docker
Compose with Traefik and Pocket ID). There is **no hosted service**: we run
our own instances, and anyone can deploy their own. Because of that there is
**no response-time SLA** — we aim to acknowledge reports promptly, but
timelines are best-effort.

## Reporting a Vulnerability

Use **GitHub private vulnerability reporting**:

- Open: <https://github.com/<owner>/miootz/security/advisories/new>
  (Security tab → "Report a vulnerability").

Please do **not** open a public issue for security problems.

## Scope

What we consider in scope:

- **FastAPI backend** (`app/`) — API endpoints, auth middleware, JWT
  validation, rate limiting, the SQLite database layer.
- **React frontend** (`frontend/`) — client-side auth flow, routing,
  token handling.
- **Pocket ID OIDC integration** — the OIDC authorization-code flow with
  PKCE (S256) in `frontend/src/auth/pocketIdOidc.ts` and RS256 JWT
  validation in `app/services/pocket_id_jwt.py`.
- **Web Push / VAPID** — VAPID-signed push delivery (`pywebpush` /
  `py-vapid`). There is no mail server and no SMTP in this stack; if you
  find an issue in push delivery, it belongs to this component.

Out of scope: bugs in upstream dependencies themselves (report those to the
upstream project), and anything requiring physical access to a private,
self-run instance without credentials.

## What to Include in a Report

- **The affected endpoint(s)** or component (e.g.
  `POST /api/...`, OIDC callback, push subscription endpoint).
- **Version / commit** you tested (git SHA, or release tag if applicable).
- **Steps to reproduce** — a minimal, clear sequence.
- **REDACTED evidence only**: do **not** paste live tokens, JWTs, session
  secrets, VAPID private keys, or API keys into the report. Truncate or
  replace secrets with `<REDACTED>`.
- Impact: what an attacker gains, and under what prerequisites.

## Known Trade-off: Tokens in `localStorage`

By design, the frontend keeps OIDC access/refresh tokens in
`localStorage` (`miootz_tokens`) so sessions survive reloads and browser
restarts. This means the tokens are **readable by any XSS payload** running
on the app's origin. We accepted this trade-off deliberately for an
internal-first, trusted-user application; it is documented in `AGENTS.md`
and `README.md`. If you have a mitigation that doesn't break session
persistence, we'd love to hear it.

## Preferred Language

English is fine; just be specific and include repro steps.
