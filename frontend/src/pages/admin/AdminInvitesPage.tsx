import { useState } from 'react';
import { Copy, Loader2, MailCheck } from 'lucide-react';
import { format } from 'date-fns';
import { adminCreateInvite } from '../../api/adminApi';

export function AdminInvitesPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    invite_link: string;
    expires_at: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const r = await adminCreateInvite(trimmed);
      setResult(r);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invite');
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!result?.invite_link) return;
    try {
      await navigator.clipboard.writeText(result.invite_link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Invites
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
          Create a one-time link so a new player can register. They still need an
          Authelia account with the same email.
        </p>
      </header>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-4"
      >
        {error && (
          <div
            className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-800 dark:text-red-200"
            role="alert"
          >
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="player@example.com"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-violet-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <MailCheck className="w-4 h-4" />
          )}
          Generate invite link
        </button>
      </form>

      {result && (
        <div className="mt-8 rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/80 dark:bg-emerald-950/30 p-6">
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200 mb-2">
            Invite ready
          </p>
          <p className="text-xs text-emerald-800/80 dark:text-emerald-300/90 mb-3">
            Expires {format(new Date(result.expires_at), 'PPp')}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <code className="flex-1 text-xs sm:text-sm break-all rounded-lg bg-white/80 dark:bg-gray-950 px-3 py-2 border border-emerald-200 dark:border-emerald-800 text-gray-800 dark:text-gray-200">
              {result.invite_link}
            </code>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex items-center justify-center gap-2 shrink-0 px-4 py-2 rounded-xl bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800"
            >
              <Copy className="w-4 h-4" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
