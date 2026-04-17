import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
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

  const inviteUrl = useMemo(
    () =>
      token
        ? `${window.location.origin}/invites/verify/${encodeURIComponent(token)}`
        : '',
    [token],
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
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-gray-50 dark:from-gray-950 dark:to-gray-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-violet-200/80 dark:border-violet-900/50 bg-white dark:bg-gray-900 p-8 shadow-xl text-center space-y-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            Footy Legends
          </p>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            Invite
          </h1>
        </div>

        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3 text-gray-600 dark:text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-violet-600 motion-reduce:animate-none" aria-hidden />
            <p className="text-sm">Confirming your invite…</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-4 text-left">
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

            <ol className="list-decimal list-inside space-y-1 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-gray-50 dark:bg-gray-950/50">
              <li>Sign in with the button below</li>
              <li>Change your password in Authelia</li>
              <li>Open Footy Legends and join your first meetup</li>
            </ol>

            {inviteUrl && (
              <div className="flex flex-col items-center gap-2 pt-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Scan on your phone
                </p>
                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950">
                  <QRCodeSVG value={inviteUrl} size={160} level="M" />
                </div>
              </div>
            )}

            <div className="pt-2 flex flex-col gap-2">
              <a
                href={getAuthLoginUrl(window.location.origin + '/')}
                className="inline-flex justify-center items-center px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 active:scale-[0.98]"
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
