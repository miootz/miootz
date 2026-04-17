import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, MailCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';
import {
  adminCreateInvite,
  adminListInvites,
  type AdminInviteRow,
} from '../../api/adminApi';
import { AdminBreadcrumb } from '../../components/admin/AdminBreadcrumb';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import { useToast } from '../../context/ToastContext';

export function AdminInvitesPage() {
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    invite_link: string;
    expires_at: string;
  } | null>(null);
  const [history, setHistory] = useState<AdminInviteRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [bulkText, setBulkText] = useState('');
  const [bulkWorking, setBulkWorking] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const rows = await adminListInvites({ limit: 100 });
      setHistory(rows);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

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
    try {
      const r = await adminCreateInvite(trimmed);
      setResult(r);
      setEmail('');
      showToast('Invite link created.', 'success');
      void loadHistory();
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
      showToast('Copied to clipboard.', 'success');
    } catch {
      setError('Could not copy to clipboard.');
    }
  }

  async function runBulk() {
    const lines = bulkText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const emails = [...new Set(lines)].filter((e) => e.includes('@'));
    if (emails.length === 0) {
      setError('Add at least one email (one per line).');
      return;
    }
    setBulkWorking(true);
    setError(null);
    let ok = 0;
    try {
      for (const em of emails) {
        await adminCreateInvite(em);
        ok += 1;
      }
      showToast(`Created ${ok} invite link(s).`, 'success');
      setBulkText('');
      void loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk invite failed partway.');
    } finally {
      setBulkWorking(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      <AdminPageHeader
        breadcrumb={
          <AdminBreadcrumb
            items={[{ label: 'Admin', to: '/admin' }, { label: 'Invites' }]}
          />
        }
        title="Invites"
        subtitle="Create one-time links so new players can register. They still need an Authelia account with the same email."
      />

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-4 transition-colors"
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
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 transition-colors"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-60 active:scale-[0.98] transition-colors"
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
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/80 dark:bg-emerald-950/30 p-6 transition-colors">
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200 mb-2">
            Invite ready
          </p>
          <p className="text-xs text-emerald-800/80 dark:text-emerald-300/90 mb-3">
            Expires {format(new Date(result.expires_at), 'EEE d MMM yyyy, HH:mm')}
          </p>
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <div className="flex flex-col sm:flex-row gap-2 flex-1 min-w-0">
              <code className="flex-1 text-xs sm:text-sm break-all rounded-lg bg-white/80 dark:bg-gray-950 px-3 py-2 border border-emerald-200 dark:border-emerald-800 text-gray-800 dark:text-gray-200">
                {result.invite_link}
              </code>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="inline-flex items-center justify-center gap-2 shrink-0 min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors"
              >
                <Copy className="w-4 h-4" />
                Copy
              </button>
            </div>
            <div className="shrink-0 rounded-xl bg-white p-3 border border-emerald-200 dark:border-emerald-800 dark:bg-gray-950">
              <QRCodeSVG value={result.invite_link} size={120} level="M" />
              <p className="text-xs text-center text-gray-500 mt-2">Scan to open</p>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-3 transition-colors">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Bulk invite
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Paste one email per line. Each gets its own link (sequential create).
        </p>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={5}
          placeholder={'a@x.com\nb@y.com'}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm font-mono transition-colors"
        />
        <button
          type="button"
          disabled={bulkWorking}
          onClick={() => void runBulk()}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {bulkWorking ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Create all invites
        </button>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Invite history
        </h2>
        {historyLoading ? (
          <p className="text-sm text-gray-500 motion-safe:animate-pulse">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-500">No invites yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">
                    Email
                  </th>
                  <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">
                    Created
                  </th>
                  <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">
                    Expires
                  </th>
                  <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const expired = new Date(row.expires_at) < new Date();
                  const status = row.used
                    ? 'Used'
                    : expired
                      ? 'Expired'
                      : 'Active';
                  return (
                    <tr
                      key={row.token}
                      className="border-b border-gray-100 dark:border-gray-800/80 last:border-0"
                    >
                      <td className="py-2 px-3">
                        <a
                          href={`mailto:${row.email}`}
                          className="text-violet-600 dark:text-violet-400 hover:underline"
                        >
                          {row.email}
                        </a>
                      </td>
                      <td className="py-2 px-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {format(new Date(row.created_at), 'd MMM yyyy HH:mm')}
                      </td>
                      <td className="py-2 px-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {format(new Date(row.expires_at), 'd MMM yyyy HH:mm')}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            row.used
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                              : expired
                                ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                          }`}
                        >
                          {status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
