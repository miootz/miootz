import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { RefreshCw, LogIn } from 'lucide-react';
import { useAuth } from './useAuth';

const RETURN_PATH_KEY = 'miootz_return_path';

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 border-2 border-teal-700 border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Checking sign-in…
          </p>
        </div>
      </div>
    );
  }

  if (error && !me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-gray-900 p-8 shadow-lg text-center space-y-4">
          <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={() => {
                redirectingRef.current = false;
                void refresh();
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
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
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-teal-700 text-white hover:bg-teal-800 text-sm"
            >
              <LogIn className="w-4 h-4" />
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 border-2 border-teal-700 border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Redirecting to sign-in…
          </p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
