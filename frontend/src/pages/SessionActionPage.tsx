import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { postSessionLinkAction } from '../api/sessionActionsApi';

type Phase = 'loading' | 'done' | 'error' | 'missing';

/**
 * Email links: `/session-action?t=<signed-token>` — no login required; token identifies the user.
 */
export function SessionActionPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('t');
  const [phase, setPhase] = useState<Phase>(() => (token ? 'loading' : 'missing'));
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await postSessionLinkAction(token);
        if (!cancelled) {
          setMessage(res.message);
          setPhase('done');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Something went wrong');
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
          Session action
        </h1>

        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3 text-gray-600 dark:text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-violet-600" aria-hidden />
            <p className="text-sm">Processing…</p>
          </div>
        )}

        {phase === 'missing' && (
          <p className="text-sm text-amber-800 dark:text-amber-200">
            This page needs a valid link from your email (missing <code className="text-xs">t</code>{' '}
            parameter).
          </p>
        )}

        {phase === 'error' && error && (
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        )}

        {phase === 'done' && (
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {message}
          </p>
        )}

        <Link
          to="/"
          className="inline-block text-sm text-violet-600 dark:text-violet-400 hover:underline"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
