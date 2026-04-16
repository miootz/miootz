import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchMe } from '../api/meApi';
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
      setMe(null);
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
