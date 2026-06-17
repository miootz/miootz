import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, XCircle } from 'lucide-react';

/**
 * OIDC callback page. The AuthProvider handles the token exchange,
 * but this page provides visual feedback while that happens.
 */
export function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    // The AuthProvider handles the callback automatically.
    // If we're still here after a timeout, something went wrong.
    const timer = setTimeout(() => {
      setError('Authentication is taking longer than expected. Redirecting…');
      setTimeout(() => navigate('/'), 2000);
    }, 10000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-gray-50 dark:from-gray-950 dark:to-gray-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-violet-200/80 dark:border-violet-900/50 bg-white dark:bg-gray-900 p-8 shadow-xl text-center space-y-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            Miootz
          </p>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            Signing in…
          </h1>
        </div>

        {!error ? (
          <div className="flex flex-col items-center gap-3 text-gray-600 dark:text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-violet-600 motion-reduce:animate-none" aria-hidden />
            <p className="text-sm">Completing sign-in…</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-center">
              <XCircle className="w-10 h-10 text-amber-500" aria-hidden />
            </div>
            <p className="text-sm text-amber-800 dark:text-amber-200">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
