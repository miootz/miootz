import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchMe, type MeResponse } from '../api/meApi';
import { cacheGet, cachePut } from '../offline/db';
import { CACHE_PROFILE_ME } from '../offline/cacheKeys';
import { AuthContext, type AuthState } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AuthState['me']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchMe();
      setMe(data);
      if (data) {
        await cachePut(CACHE_PROFILE_ME, data);
      }
    } catch (e) {
      const cached = await cacheGet<MeResponse>(CACHE_PROFILE_ME);
      const msg = e instanceof Error ? e.message : 'Failed to load profile';
      const offline =
        typeof navigator !== 'undefined' && !navigator.onLine;
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
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ me, loading, error, refresh }),
    [me, loading, error, refresh]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}
