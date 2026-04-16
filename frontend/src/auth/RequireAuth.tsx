import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from './useAuth';
import { getAuthLoginUrl } from './authPortal';

/** Set right before redirecting to Authelia; if still unauthenticated after return, stop looping. */
const AUTH_REDIRECT_CYCLE_KEY = 'footy_authelia_redirect_return';

export function RequireAuth() {
  const { me, loading, error, refresh } = useAuth();
  const redirectingRef = useRef(false);

  useEffect(() => {
    if (me) sessionStorage.removeItem(AUTH_REDIRECT_CYCLE_KEY);
  }, [me]);

  useEffect(() => {
    if (loading || me || error) return;
    if (redirectingRef.current) return;
    if (sessionStorage.getItem(AUTH_REDIRECT_CYCLE_KEY)) return;
    redirectingRef.current = true;
    sessionStorage.setItem(AUTH_REDIRECT_CYCLE_KEY, '1');
    window.location.replace(getAuthLoginUrl(window.location.href));
  }, [loading, me, error]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 border-2 border-violet-600 border-t-transparent rounded-full animate-spin"
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
        <div className="max-w-md w-full rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-gray-900 p-8 shadow-lg text-center">
          <p className="text-red-800 dark:text-red-200 text-sm mb-4">{error}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const stuckAfterAuthelia =
    !loading && !me && !error && sessionStorage.getItem(AUTH_REDIRECT_CYCLE_KEY);

  if (stuckAfterAuthelia) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-6">
        <div className="max-w-md w-full rounded-2xl border border-amber-200 dark:border-amber-900 bg-white dark:bg-gray-900 p-8 shadow-lg text-center space-y-4">
          <p className="text-gray-800 dark:text-gray-100 text-sm">
            You returned from sign-in, but the app still cannot verify your session. This
            usually means the API is not receiving Authelia headers (for example local dev
            proxying <code className="text-xs">/api</code> straight to the backend), or the
            account could not be created.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem(AUTH_REDIRECT_CYCLE_KEY);
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
                sessionStorage.removeItem(AUTH_REDIRECT_CYCLE_KEY);
                window.location.replace(getAuthLoginUrl(window.location.href));
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white hover:bg-violet-700 text-sm"
            >
              Sign in again
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
            className="w-10 h-10 border-2 border-violet-600 border-t-transparent rounded-full animate-spin"
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
