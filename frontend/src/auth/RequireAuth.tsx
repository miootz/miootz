import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { RefreshCw, LogIn } from 'lucide-react';
import { useAuth } from './useAuth';
import { AppSplash } from '../components/AppSplash';
import { roomStorageKey } from '../utils/demoRoom';

const RETURN_PATH_KEY = roomStorageKey('miootz_return_path');

export function RequireAuth() {
  const { me, loading, error, refresh, login } = useAuth();
  const redirectingRef = useRef(false);

  useEffect(() => {
    if (loading || me || error) return;
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    // Remember where the user was trying to go so we can return after login
    sessionStorage.setItem(
      RETURN_PATH_KEY,
      window.location.pathname + window.location.search,
    );
    void login();
  }, [loading, me, error, login]);

  if (loading || (!me && !error)) {
    return (
      <AppSplash status={loading ? 'Checking sign-in…' : 'Redirecting to sign-in…'} />
    );
  }

  if (error && !me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-board p-6">
        <div className="max-w-md w-full border border-danger/40 bg-panel p-8 shadow-lg text-center space-y-4">
          <p className="text-danger text-sm">{error}</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={() => {
                redirectingRef.current = false;
                void refresh();
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-line text-ink-dim hover:bg-raised hover:text-ink text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                redirectingRef.current = false;
                void login();
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-ink text-board hover:bg-white/90 text-sm font-bold"
            >
              <LogIn className="w-4 h-4" />
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
