import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, XCircle } from 'lucide-react';
import { useAuth } from '../auth/useAuth';

/**
 * OIDC callback page. The AuthProvider handles the token exchange and, on
 * success, redirects the whole page (window.location.href) to the return
 * path — this page only needs to catch the failure case and leave.
 */
export function AuthCallbackPage() {
  const { loading, error: authError } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!authError) {
      // Success already redirected the page; this is just a safety net.
      navigate('/');
      return;
    }
    // Show the provider's error briefly, then bail to home.
    const t = setTimeout(() => navigate('/'), 5000);
    return () => clearTimeout(t);
  }, [loading, authError, navigate]);

  const failed = !loading && !!authError;

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

        {!failed ? (
          <div className="flex flex-col items-center gap-3 text-gray-600 dark:text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-violet-600 motion-reduce:animate-none" aria-hidden />
            <p className="text-sm">Completing sign-in…</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-center">
              <XCircle className="w-10 h-10 text-amber-500" aria-hidden />
            </div>
            <p className="text-sm text-amber-800 dark:text-amber-200">{authError}</p>
          </div>
        )}
      </div>
    </div>
  );
}
