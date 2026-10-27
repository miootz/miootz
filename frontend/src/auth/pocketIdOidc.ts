/**
 * Pocket ID OIDC client (PKCE S256, public client).
 *
 * Discovery: fetch /.well-known/openid-configuration → extract endpoints.
 * Flow: authorization_code + PKCE S256.
 * Tokens persisted in localStorage for cross-session survival.
 */

// ── Env ────────────────────────────────────────────────────────────────────

// Plain HTTP (non-localhost) is not a secure context: crypto.subtle /
// crypto.randomUUID don't exist, so sign-in can never start. The local dev
// stack serves the same app over mkcert HTTPS on :8443 — bounce there once
// instead of failing inside authorize().
if (
  window.location.protocol === "http:" &&
  !["localhost", "127.0.0.1"].includes(window.location.hostname)
) {
  const httpsUrl = new URL(window.location.href);
  httpsUrl.protocol = "https:";
  if (httpsUrl.port === "8880") httpsUrl.port = "8443";
  window.location.replace(httpsUrl.toString());
}

const OIDC_ISSUER =
  (import.meta.env.VITE_POCKET_ID_ISSUER as string | undefined) ??
  (() => {
    const { protocol, hostname, port } = window.location;
    if (hostname.startsWith("app.")) {
      const host = `auth.${hostname.slice(4)}`;
      const p = port ? `:${port}` : "";
      return `${protocol}//${host}${p}`;
    }
    // Standalone `npm run dev` (localhost): the OIDC issuer is the local dev
    // stack's Pocket ID, not the page's own origin (which serves the SPA).
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "https://auth.miootz.local:8443";
    }
    return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
  })();

const OIDC_CLIENT_ID =
  (import.meta.env.VITE_POCKET_ID_CLIENT_ID as string | undefined) ??
  "miootz-app";

// Public OIDC client by design: a secret embedded in a browser bundle is not
// a secret. Confidentiality comes from PKCE S256 (see authorize()/exchangeCode()).
// The client must be registered in Pocket ID WITHOUT a secret requirement.

const REDIRECT_URI = `${window.location.origin}/auth/callback`;

const OIDC_SCOPE = "openid email profile groups";

// ── Cached OIDC discovery ──────────────────────────────────────────────────
interface OidcEndpoints {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

let _endpoints: OidcEndpoints | null = null;

const _FETCH_TIMEOUT_MS = 8_000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), _FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

export async function discoverEndpoints(): Promise<OidcEndpoints> {
  if (_endpoints) return _endpoints;
  const issuer = OIDC_ISSUER.replace(/\/+$/, "");
  const url = `${issuer}/.well-known/openid-configuration`;
  const r = await fetchWithTimeout(url).catch(() => {
    throw new Error(
      `Cannot reach OIDC issuer at ${url}. Is the Pocket ID service running?`,
    );
  });
  if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status} ${url}`);
  const body = await r.text();
  // Same-origin fallback hit the SPA: Vite/traefik serves index.html (200)
  // for /.well-known/..., which r.json() would reject with a cryptic
  // "Unexpected token '<'". Say what actually needs configuring.
  if (body.trimStart().startsWith("<")) {
    throw new Error(
      `OIDC discovery at ${url} returned HTML, not JSON. Set VITE_POCKET_ID_ISSUER to your Pocket ID issuer (e.g. https://auth.miootz.local:8443) and restart the dev server.`,
    );
  }
  const data = JSON.parse(body) as Record<string, unknown>;
  _endpoints = {
    authorization_endpoint: _assertIssuerOrigin(
      String(data.authorization_endpoint),
      "authorization_endpoint",
    ),
    token_endpoint: _assertIssuerOrigin(
      String(data.token_endpoint),
      "token_endpoint",
    ),
    jwks_uri: _assertIssuerOrigin(String(data.jwks_uri), "jwks_uri"),
    end_session_endpoint: _assertIssuerOrigin(
      String(data.end_session_endpoint ?? ""),
      "end_session_endpoint",
    ),
  };
  return _endpoints;
}

/**
 * Allowlist check: a URL is only usable when its origin (scheme + host +
 * port) equals the configured issuer's origin. Every value that reaches
 * `window.location.href` or a token/jwks fetch in this module passes through
 * here, so a compromised or misconfigured discovery document cannot steer
 * the browser to a foreign host.
 */
function _assertIssuerOrigin(raw: string, name: string): string {
  if (!raw) return "";
  let endpointUrl: URL;
  let issuerUrl: URL;
  try {
    endpointUrl = new URL(raw);
    issuerUrl = new URL(`${OIDC_ISSUER.replace(/\/+$/, "")}/`);
  } catch {
    throw new Error(`OIDC: ${name} is not a valid URL: ${raw}`);
  }
  if (endpointUrl.origin !== issuerUrl.origin) {
    throw new Error(
      `OIDC: ${name} origin ${endpointUrl.origin} does not match issuer origin ${issuerUrl.origin}`,
    );
  }
  return raw;
}

// ── PKCE helpers ───────────────────────────────────────────────────────────
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function computeCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(buffer: Uint8Array): string {
  const binary = Array.from(buffer, (b) => String.fromCharCode(b)).join("");
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── Token types ────────────────────────────────────────────────────────────
export interface OidcTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

// ── Authorize (redirect to Pocket ID) ──────────────────────────────────────
const _CODE_VERIFIER_KEY = "miootz_pkce_verifier";
const _OIDC_STATE_KEY = "miootz_oidc_state";

export async function authorize(): Promise<void> {
  const endpoints = await discoverEndpoints();
  const verifier = generateCodeVerifier();
  const challenge = await computeCodeChallenge(verifier);
  const state = crypto.randomUUID();

  sessionStorage.setItem(_CODE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(_OIDC_STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: OIDC_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: OIDC_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  // Allowlisted: full redirect URL re-validated against the issuer origin
  // (params are internally generated PKCE values, never user input).
  const url = _assertIssuerOrigin(
    `${endpoints.authorization_endpoint}?${params}`,
    "authorize redirect",
  );
  // False positive: `url` is origin-equal to the configured OIDC issuer
  // via _assertIssuerOrigin above.
  // pi-lens-ignore: no-open-redirect, ts-open-redirect
  window.location.href = url;
}

// ── Handle callback (exchange code for tokens) ─────────────────────────────
export async function handleCallback(): Promise<OidcTokens> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  if (error) {
    throw new Error(
      `OIDC error: ${error}${params.get("error_description") ? ` — ${params.get("error_description")}` : ""}`,
    );
  }

  if (!code) {
    throw new Error("No authorization code in callback");
  }

  // Verify state
  const expectedState = sessionStorage.getItem(_OIDC_STATE_KEY);
  if (state !== expectedState) {
    throw new Error("OIDC state mismatch");
  }

  const verifier = sessionStorage.getItem(_CODE_VERIFIER_KEY);
  if (!verifier) {
    throw new Error("No PKCE verifier found");
  }

  // Clean up
  sessionStorage.removeItem(_CODE_VERIFIER_KEY);
  sessionStorage.removeItem(_OIDC_STATE_KEY);

  // Exchange code for tokens
  const endpoints = await discoverEndpoints();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: OIDC_CLIENT_ID,
    code_verifier: verifier,
  });

  const r = await fetchWithTimeout(endpoints.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Token exchange failed: ${r.status} ${text}`);
  }

  const data = (await r.json()) as {
    access_token: string;
    id_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000, // 30s buffer
  };
}

// ── Refresh tokens ─────────────────────────────────────────────────────────
export async function refreshTokens(refreshToken: string): Promise<OidcTokens> {
  const endpoints = await discoverEndpoints();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: OIDC_CLIENT_ID,
  });

  const r = await fetchWithTimeout(endpoints.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Token refresh failed: ${r.status} ${text}`);
  }

  const data = (await r.json()) as {
    access_token: string;
    id_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  };
}

// ── Logout ─────────────────────────────────────────────────────────────────
export async function logout(): Promise<void> {
  const endpoints = await discoverEndpoints();
  if (endpoints.end_session_endpoint) {
    // Clear tokens first (so the redirect doesn't carry them)
    const params = new URLSearchParams({
      client_id: OIDC_CLIENT_ID,
      post_logout_redirect_uri: `${window.location.origin}/`,
    });
    const idToken = localStorage.getItem("miootz_id_token");
    if (idToken) {
      params.set("id_token_hint", idToken);
    }
    // Allowlisted: full redirect URL re-validated against the issuer origin —
    // no user-controlled input reaches this sink.
    // pi-lens-ignore: no-open-redirect, ts-open-redirect
    window.location.href = _assertIssuerOrigin(
      `${endpoints.end_session_endpoint}?${params}`,
      "logout redirect",
    );
    return;
  }
  // Fallback: issuer constant (build-time env or same-host derivation),
  // still passed through the origin allowlist for consistency.
  // pi-lens-ignore: no-open-redirect, ts-open-redirect
  window.location.href = _assertIssuerOrigin(
    OIDC_ISSUER.replace(/\/+$/, ""),
    "issuer home redirect",
  );
}

// ── Get Pocket ID base URL ─────────────────────────────────────────────────
export function getPocketIdUrl(): string {
  return OIDC_ISSUER.replace(/\/+$/, "");
}
