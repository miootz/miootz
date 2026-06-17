/**
 * Pocket ID OIDC client (PKCE S256, public client).
 *
 * Discovery: fetch /.well-known/openid-configuration → extract endpoints.
 * Flow: authorization_code + PKCE S256.
 * Tokens persisted in localStorage for cross-session survival.
 */

// ── Env ────────────────────────────────────────────────────────────────────
const OIDC_ISSUER =
  (import.meta.env.VITE_POCKET_ID_ISSUER as string | undefined) ??
  (() => {
    const { protocol, hostname, port } = window.location;
    if (hostname.startsWith('app.')) {
      const host = `auth.${hostname.slice(4)}`;
      const p = port ? `:${port}` : '';
      return `${protocol}//${host}${p}`;
    }
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
  })();

const OIDC_CLIENT_ID =
  (import.meta.env.VITE_POCKET_ID_CLIENT_ID as string | undefined) ?? 'miootz-app';

const OIDC_CLIENT_SECRET =
  (import.meta.env.VITE_POCKET_ID_CLIENT_SECRET as string | undefined) ?? '';

const REDIRECT_URI = `${window.location.origin}/auth/callback`;

const OIDC_SCOPE = 'openid email profile groups';

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
  const issuer = OIDC_ISSUER.replace(/\/+$/, '');
  const url = `${issuer}/.well-known/openid-configuration`;
  const r = await fetchWithTimeout(url).catch(() => {
    throw new Error(
      `Cannot reach OIDC issuer at ${url}. Is the Pocket ID service running?`,
    );
  });
  if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status} ${url}`);
  const data = (await r.json()) as Record<string, unknown>;
  _endpoints = {
    authorization_endpoint: String(data.authorization_endpoint),
    token_endpoint: String(data.token_endpoint),
    jwks_uri: String(data.jwks_uri),
    end_session_endpoint: String(data.end_session_endpoint ?? ''),
  };
  return _endpoints;
}

// ── PKCE helpers ───────────────────────────────────────────────────────────
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function computeCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(buffer: Uint8Array): string {
  const binary = Array.from(buffer, (b) => String.fromCharCode(b)).join('');
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ── Token types ────────────────────────────────────────────────────────────
export interface OidcTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

// ── Authorize (redirect to Pocket ID) ──────────────────────────────────────
const _CODE_VERIFIER_KEY = 'miootz_pkce_verifier';
const _OIDC_STATE_KEY = 'miootz_oidc_state';

export async function authorize(returnTo?: string): Promise<void> {
  const endpoints = await discoverEndpoints();
  const verifier = generateCodeVerifier();
  const challenge = await computeCodeChallenge(verifier);
  const state = crypto.randomUUID();

  sessionStorage.setItem(_CODE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(_OIDC_STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OIDC_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: OIDC_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

  if (returnTo) {
    params.set('login_hint', returnTo);
  }

  const url = `${endpoints.authorization_endpoint}?${params}`;
  window.location.href = url;
}

// ── Handle callback (exchange code for tokens) ─────────────────────────────
export async function handleCallback(): Promise<OidcTokens> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  if (error) {
    throw new Error(
      `OIDC error: ${error}${params.get('error_description') ? ` — ${params.get('error_description')}` : ''}`,
    );
  }

  if (!code) {
    throw new Error('No authorization code in callback');
  }

  // Verify state
  const expectedState = sessionStorage.getItem(_OIDC_STATE_KEY);
  if (state !== expectedState) {
    throw new Error('OIDC state mismatch');
  }

  const verifier = sessionStorage.getItem(_CODE_VERIFIER_KEY);
  if (!verifier) {
    throw new Error('No PKCE verifier found');
  }

  // Clean up
  sessionStorage.removeItem(_CODE_VERIFIER_KEY);
  sessionStorage.removeItem(_OIDC_STATE_KEY);

  // Exchange code for tokens
  const endpoints = await discoverEndpoints();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: OIDC_CLIENT_ID,
    code_verifier: verifier,
    ...(OIDC_CLIENT_SECRET ? { client_secret: OIDC_CLIENT_SECRET } : {}),
  });

  const r = await fetchWithTimeout(endpoints.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OIDC_CLIENT_ID,
    ...(OIDC_CLIENT_SECRET ? { client_secret: OIDC_CLIENT_SECRET } : {}),
  });

  const r = await fetchWithTimeout(endpoints.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    const idToken = localStorage.getItem('miootz_id_token');
    if (idToken) {
      params.set('id_token_hint', idToken);
    }
    window.location.href = `${endpoints.end_session_endpoint}?${params}`;
    return;
  }
  // Fallback: just redirect to Pocket ID home
  window.location.href = OIDC_ISSUER.replace(/\/+$/, '');
}

// ── Decode ID token (for display name, etc.) ───────────────────────────────
export function decodeIdToken(idToken: string): Record<string, unknown> {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return {};
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch {
    return {};
  }
}

// ── Get Pocket ID base URL ─────────────────────────────────────────────────
export function getPocketIdUrl(): string {
  return OIDC_ISSUER.replace(/\/+$/, '');
}
