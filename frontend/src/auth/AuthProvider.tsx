import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { type MeResponse } from '../api/meApi';
import { cacheDelete, cacheGet, cachePut } from '../offline/db';
import { CACHE_PROFILE_ME } from '../offline/cacheKeys';
import { consumeReturnPath } from './returnPath';
import { AuthContext, type AuthState } from './auth-context';
import type { OidcTokens } from './pocketIdOidc';
import {
  authorize,
  handleCallback,
  logout as oidcLogout,
  refreshTokens as oidcRefreshTokens,
} from './pocketIdOidc';

const TOKENS_KEY = 'miootz_tokens';
const SESSION_REJECTED = 'Miootz could not verify this sign-in. Please sign in again.';
/** Refresh this long before expiry so a long live session never hits a 401. */
const REFRESH_BUFFER_MS = 60_000;

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
  const isCallback = useMatch('/auth/callback') !== null;
  const navigate = useNavigate();
  const initialized = useRef(false);
  // One in-flight refresh at a time: concurrent callers share the same
  // promise, so a rotating refresh token cannot be consumed twice and the
  // loser's catch cannot wipe a session the winner just renewed.
  const refreshInFlight = useRef<Promise<OidcTokens | null> | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const tryRefreshRef = useRef<((t: OidcTokens) => Promise<OidcTokens | null>) | null>(null);

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

  const scheduleRefresh = useCallback((t: OidcTokens) => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    const delay = Math.max(t.expiresAt - Date.now() - REFRESH_BUFFER_MS, 5_000);
    refreshTimer.current = window.setTimeout(
      () => void tryRefreshRef.current?.(t),
      delay,
    );
  }, []);

  const tryRefreshTokens = useCallback(
    async (oldTokens: OidcTokens): Promise<OidcTokens | null> => {
      if (refreshInFlight.current) return refreshInFlight.current;
      const p = (async () => {
        try {
          const newTokens = await oidcRefreshTokens(oldTokens.refreshToken);
          setTokens(newTokens);
          saveTokens(newTokens);
          scheduleRefresh(newTokens);
          return newTokens;
        } catch {
          clearTokens();
          setTokens(null);
          return null;
        } finally {
          refreshInFlight.current = null;
        }
      })();
      refreshInFlight.current = p;
      return p;
    },
    [scheduleRefresh],
  );
  tryRefreshRef.current = tryRefreshTokens;

  useEffect(
    () => () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
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
    if (import.meta.env.VITE_DEMO === '1') {
      window.location.replace('/api/demo');
      return;
    }
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
    if (import.meta.env.VITE_DEMO === '1') {
      window.location.replace('/api/demo');
      return;
    }
    await oidcLogout();
  }, []);

  // ── Initialization: handle callback or restore session ──────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const init = async () => {
      if (isCallback) {
        try {
          const newTokens = await handleCallback();
          // Finish the session before the protected route can start another sign-in.
          const data = await fetchMeWithAuth(newTokens);
          if (!data) throw new Error(SESSION_REJECTED);
          saveTokens(newTokens);
          setTokens(newTokens);
          setMe(data);
          scheduleRefresh(newTokens);
          void cachePut(CACHE_PROFILE_ME, data).catch(() => {});
          void navigate(consumeReturnPath(), { replace: true });
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
        // Keep the meetup alive past the access-token lifetime (finding 5).
        scheduleRefresh(tokensToUse);

        try {
          const data = await fetchMeWithAuth(tokensToUse);
          setMe(data);
          if (data) {
            await cachePut(CACHE_PROFILE_ME, data);
          } else {
            clearTokens();
            setTokens(null);
            if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
            setError(SESSION_REJECTED);
            await cacheDelete(CACHE_PROFILE_ME).catch(() => {});
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
  }, [isCallback, navigate, fetchMeWithAuth, tryRefreshTokens, scheduleRefresh]);

  const value = useMemo(
    () => ({ me, loading, error, tokens, refresh, login, logout }),
    [me, loading, error, tokens, refresh, login, logout],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}
