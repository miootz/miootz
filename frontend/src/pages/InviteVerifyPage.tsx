import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { beginInviteVerify, completeInviteVerify } from '../api/invitesApi';

type Phase = 'loading' | 'password' | 'submitting' | 'error';

const MIN_LEN = 10;

/**
 * Invite link from email: `/invites/verify/:token` — public route (no Authelia yet).
 */
export function InviteVerifyPage() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>(() => (token ? 'loading' : 'error'));
  const [username, setUsername] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(() =>
    token ? null : 'Invalid link.',
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await beginInviteVerify(token);
        if (!cancelled) {
          setUsername(res.username);
          setEmail(res.email);
          setSetupToken(res.setup_token);
          setPhase('password');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not start registration');
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!setupToken) return;
    if (password.length < MIN_LEN || passwordConfirm.length < MIN_LEN) {
      setError(`Password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (password !== passwordConfirm) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setPhase('submitting');
    try {
      const res = await completeInviteVerify(setupToken, password, passwordConfirm);
      window.location.assign(res.redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish registration');
      setPhase('password');
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-gray-50 dark:from-gray-950 dark:to-gray-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-violet-200/80 dark:border-violet-900/50 bg-white dark:bg-gray-900 p-8 shadow-xl text-center space-y-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            Footy Legends
          </p>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            Join
          </h1>
        </div>

        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3 text-gray-600 dark:text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-violet-600 motion-reduce:animate-none" aria-hidden />
            <p className="text-sm">Checking your invite…</p>
          </div>
        )}

        {phase === 'password' && (
          <form onSubmit={onSubmit} className="space-y-4 text-left">
            <div className="flex justify-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" aria-hidden />
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Choose a password for your account. You will be signed in and taken to the app.
            </p>
            {username && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Username:{' '}
                <strong className="text-gray-800 dark:text-gray-200">{username}</strong>
              </p>
            )}
            {email && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Email: <span className="text-gray-800 dark:text-gray-200">{email}</span>
              </p>
            )}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
                Password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  minLength={MIN_LEN}
                  required
                />
              </label>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={passwordConfirm}
                  onChange={(ev) => setPasswordConfirm(ev.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  minLength={MIN_LEN}
                  required
                />
              </label>
            </div>
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="w-full inline-flex justify-center items-center px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 active:scale-[0.98]"
            >
              Save password & continue
            </button>
            <Link
              to="/"
              className="block text-center text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Cancel
            </Link>
          </form>
        )}

        {phase === 'submitting' && (
          <div className="flex flex-col items-center gap-3 text-gray-600 dark:text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-violet-600 motion-reduce:animate-none" aria-hidden />
            <p className="text-sm">Signing you in…</p>
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
