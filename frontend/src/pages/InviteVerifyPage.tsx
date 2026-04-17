import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { verifyInviteToken } from '../api/invitesApi';
import { getAuthLoginUrl } from '../auth/authPortal';

type Phase = 'loading' | 'done' | 'error';

/**
 * Invite link from email: `/invites/verify/:token` — public route (no Authelia yet).
 */
export function InviteVerifyPage() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>(() => (token ? 'loading' : 'error'));
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() =>
    token ? null : 'Invalid link.',
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await verifyInviteToken(token);
        if (!cancelled) {
          setMessage(res.message);
          setUsername(res.username);
          setPhase('done');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Verification failed');
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 shadow-lg text-center space-y-4">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          Invite
        </h1>

        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3 text-gray-600 dark:text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-violet-600" aria-hidden />
            <p className="text-sm">Confirming your invite…</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3 text-left">
            <div className="flex justify-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-600" aria-hidden />
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300">{message}</p>
            {username && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Authelia username:{' '}
                <strong className="text-gray-800 dark:text-gray-200">{username}</strong>
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              We sent your temporary password to your email. Sign in, then change your
              password in Authelia.
            </p>
            <div className="pt-2 flex flex-col gap-2">
              <a
                href={getAuthLoginUrl(window.location.origin + '/')}
                className="inline-flex justify-center items-center px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
              >
                Sign in
              </a>
              <Link
                to="/"
                className="inline-flex justify-center items-center px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Home
              </Link>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-3">
            <div className="flex justify-center">
              <XCircle className="w-12 h-12 text-red-500" aria-hidden />
            </div>
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            <Link
              to="/"
              className="inline-flex justify-center w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300"
            >
              Home
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
