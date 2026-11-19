import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, XCircle } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { BrandWordmark } from '../components/BrandWordmark';

/** AuthProvider navigates to the requested page after confirming the session. */
export function AuthCallbackPage() {
  const { loading, error: authError } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !authError) return;
    // Show the provider's error briefly, then bail to home.
    const t = setTimeout(() => void navigate('/', { replace: true }), 5000);
    return () => clearTimeout(t);
  }, [loading, authError, navigate]);

  const failed = !loading && !!authError;

  return (
    <div className="min-h-screen bg-board flex items-center justify-center p-6">
      <div className="max-w-md w-full border border-line bg-panel p-8 shadow-xl text-center space-y-6">
        <div className="space-y-1">
          <p className="text-ink-dim">
            <BrandWordmark />
          </p>
          <h1 className="text-xl font-semibold text-ink">
            Signing in…
          </h1>
        </div>

        {!failed ? (
          <div className="flex flex-col items-center gap-3 text-ink-dim">
            <Loader2 className="w-10 h-10 animate-spin text-live motion-reduce:animate-none" aria-hidden />
            <p className="text-sm">Completing sign-in…</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-center">
              <XCircle className="w-10 h-10 text-danger" aria-hidden />
            </div>
            <p className="text-sm text-danger">{authError}</p>
          </div>
        )}
      </div>
    </div>
  );
}
