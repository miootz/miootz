import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type MeResponse } from '../api/meApi';
import { cacheDelete, cacheGet, cachePut } from '../offline/db';
import { CACHE_PROFILE_ME } from '../offline/cacheKeys';
import { AuthContext, type AuthState } from './auth-context';
import type { OidcTokens } from './pocketIdOidc';
import {
  authorize,
  handleCallback,
  logout as oidcLogout,
  refreshTokens as oidcRefreshTokens,
} from './pocketIdOidc';

const TOKENS_KEY = 'miootz_tokens';

function loadTokens(): OidcTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as OidcTokens;
    return t;
  } catch {
    return null;
  }
}

function saveTokens(t: OidcTokens): void {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
  if (t.idToken) localStorage.setItem('miootz_id_token', t.idToken);
}

function clearTokens(): void {
  localStorage.removeItem(TOKENS_KEY);
  localStorage.removeItem('miootz_id_token');
}

/** Build fetch headers with Bearer token. */
export function authHeaders(tokens: OidcTokens | null): Record<string, string> {
  if (tokens?.accessToken) {
    return { Authorization: `Bearer ${tokens.accessToken}` };
  }
  return {};
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AuthState['me']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<OidcTokens | null>(null);
  const [searchParams] = useSearchParams();
  const initialized = useRef(false);

  const fetchMeWithAuth = useCallback(
    async (t: OidcTokens | null): Promise<MeResponse | null> => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (t?.accessToken) {
        headers.Authorization = `Bearer ${t.accessToken}`;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const r = await fetch(
        `${(import.meta.env.VITE_API_BASE as string | undefined) || '/api'}/me`,
        { headers, signal: controller.signal },
      ).finally(() => clearTimeout(timer));
      if (r.status === 401) return null;
      if (r.status === 403) {
        const j = (await r.json().catch(() => ({}))) as { detail?: string };
        throw new Error(j.detail || 'Access denied. You need an active invite to use this app.');
      }
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { detail?: string };
        throw new Error(j.detail || `HTTP ${r.status}`);
      }
      return r.json();
    },
    [],
  );

  const tryRefreshTokens = useCallback(
    async (oldTokens: OidcTokens): Promise<OidcTokens | null> => {
      try {
        const newTokens = await oidcRefreshTokens(oldTokens.refreshToken);
        setTokens(newTokens);
        saveTokens(newTokens);
        return newTokens;
      } catch {
        clearTokens();
        setTokens(null);
        return null;
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!tokens) return;
    setError(null);
    setLoading(true);
    try {
      let currentTokens = tokens;

      // If token is expired or about to expire, refresh
      if (Date.now() >= currentTokens.expiresAt) {
        const refreshed = await tryRefreshTokens(currentTokens);
        if (!refreshed) {
          setError('Session expired. Please sign in again.');
          setMe(null);
          setLoading(false);
          return;
        }
        currentTokens = refreshed;
      }

      const data = await fetchMeWithAuth(currentTokens);
      setMe(data);
      if (data) {
        await cachePut(CACHE_PROFILE_ME, data);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load profile';
      // Try cached profile
      const cached = await cacheGet<MeResponse>(CACHE_PROFILE_ME);
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (cached?.data) {
        setMe(cached.data);
        setError(offline ? 'Offline — showing saved profile.' : msg);
      } else {
        setError(msg);
        setMe(null);
      }
    } finally {
      setLoading(false);
    }
  }, [tokens, fetchMeWithAuth, tryRefreshTokens]);

  const login = useCallback(async () => {
    clearTokens();
    setMe(null);
    setTokens(null);
    setError(null);
    try {
      await authorize();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start sign-in');
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    clearTokens();
    setMe(null);
    setTokens(null);
    await oidcLogout();
  }, []);

  // ── Initialization: handle callback or restore session ──────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const init = async () => {
      // Check if we're on the callback URL
      const code = searchParams.get('code');
      if (code) {
        try {
          const newTokens = await handleCallback();
          saveTokens(newTokens);
          // Redirect to / — the session-restore path below will pick up
          // the saved tokens and fetch /me there, avoiding a slow
          // /me call on the callback page.
          window.location.href = '/';
          return;
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Authentication failed');
          setMe(null);
        } finally {
          setLoading(false);
        }
        return;
      }

      // Restore from local storage
      const storedTokens = loadTokens();
      if (storedTokens) {
        setTokens(storedTokens);

        // If expired, try refresh
        let tokensToUse = storedTokens;
        if (Date.now() >= storedTokens.expiresAt) {
          const refreshed = await tryRefreshTokens(storedTokens);
          if (!refreshed) {
            // Refresh failed — clear stale cache so RequireAuth redirects to login
            await cacheDelete(CACHE_PROFILE_ME).catch(() => {});
            setLoading(false);
            return;
          }
          tokensToUse = refreshed;
        }

        try {
          const data = await fetchMeWithAuth(tokensToUse);
          setMe(data);
          if (data) {
            await cachePut(CACHE_PROFILE_ME, data);
          }
        } catch {
          const offline = typeof navigator !== 'undefined' && !navigator.onLine;
          if (offline) {
            const cached = await cacheGet<MeResponse>(CACHE_PROFILE_ME);
            if (cached?.data) {
              setMe(cached.data);
              setError('Offline — showing saved profile.');
            } else {
              setError('Offline');
            }
          } else {
            // Online but /me failed — token likely invalid. Clear stale cache
            // so RequireAuth redirects to login rather than showing stale data.
            await cacheDelete(CACHE_PROFILE_ME).catch(() => {});
            setError('Session expired. Please sign in again.');
          }
        }
      } else {
        // No tokens — user needs to log in. Don't show stale cached profile.
      }
      setLoading(false);
    };

    void init();
  }, [searchParams, fetchMeWithAuth, tryRefreshTokens]);

  const value = useMemo(
    () => ({ me, loading, error, tokens, refresh, login, logout }),
    [me, loading, error, tokens, refresh, login, logout],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}
