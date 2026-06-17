import { useEffect, useState } from 'react';
import { Download, Loader2, Play } from 'lucide-react';
import { format } from 'date-fns';
import { adminRunRecurringNow } from '../../api/adminApi';
import { fetchSessions } from '../../api/sessionsApi';
import { parseSessionStart } from '../../utils/datetime';
import { AdminBreadcrumb } from '../../components/admin/AdminBreadcrumb';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import { useToast } from '../../context/ToastContext';
import { appendJobHistory, readJobHistory, type JobHistoryEntry } from '../../utils/adminPrefs';

export function AdminToolsPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<JobHistoryEntry[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setHistory(readJobHistory());
  }, []);

  async function runRecurring() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await adminRunRecurringNow();
      const msg = `Checked ${res.templates_checked} template(s); created ${res.sessions_created} new session(s).`;
      setMessage(msg);
      showToast(msg, 'success');
      appendJobHistory({
        label: 'Run recurring jobs now',
        detail: `${res.templates_checked} templates · ${res.sessions_created} session(s) created`,
      });
      setHistory(readJobHistory());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Job failed');
    } finally {
      setLoading(false);
    }
  }

  async function exportSessionsCsv() {
    setExporting(true);
    setError(null);
    try {
      const { items: sessions } = await fetchSessions({ limit: 500 });
      const headers = [
        'id',
        'start_time',
        'location',
        'fee',
        'min_players',
        'max_players',
        'confirmed_count',
        'waitlist_mode',
      ];
      const lines = [
        headers.join(','),
        ...sessions.map((s) =>
          [
            s.id,
            JSON.stringify(parseSessionStart(s.start_time).toISOString()),
            JSON.stringify(s.location),
            s.fee,
            s.min_players,
            s.max_players,
            s.confirmed_count ?? 0,
            JSON.stringify(s.waitlist_mode),
          ].join(',')
        ),
      ];
      const blob = new Blob([lines.join('\n')], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `miootz-sessions-${format(new Date(), 'yyyy-MM-dd-HHmm')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV downloaded.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-10">
      <AdminPageHeader
        breadcrumb={
          <AdminBreadcrumb
            items={[{ label: 'Admin', to: '/admin' }, { label: 'Tools' }]}
          />
        }
        title="Tools"
        subtitle="Maintenance actions that normally run on a schedule."
      />

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm transition-colors">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
          Recurring sessions
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Runs the same logic as each template’s weekly job: create the next meetup if
          missing, then send push notifications with join links. Use after downtime or
          to test your configured announce times.
        </p>

        {error && (
          <div
            className="mb-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-800 dark:text-red-200"
            role="alert"
          >
            {error}
          </div>
        )}
        {message && (
          <div
            className="mb-4 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-200"
            role="status"
          >
            {message}
          </div>
        )}

        <button
          type="button"
          onClick={() => void runRecurring()}
          disabled={loading}
          className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium hover:opacity-90 disabled:opacity-50 active:scale-[0.98] transition-opacity"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Run recurring jobs now
        </button>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm transition-colors">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
          Export data
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Download all sessions as CSV (opens in Excel / Sheets).
        </p>
        <button
          type="button"
          onClick={() => void exportSessionsCsv()}
          disabled={exporting}
          className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl border border-violet-300 dark:border-violet-700 text-violet-900 dark:text-violet-100 font-medium hover:bg-violet-50 dark:hover:bg-violet-950/40 disabled:opacity-50 transition-colors"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export sessions (CSV)
        </button>
      </div>

      <section>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
          Job history
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500">No manual runs recorded in this browser yet.</p>
        ) : (
          <ul className="space-y-2 text-sm border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-200 dark:divide-gray-800 overflow-hidden">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-3 bg-gray-50/50 dark:bg-gray-900/50"
              >
                <span className="font-medium text-gray-900 dark:text-gray-100">{h.label}</span>
                <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                  {format(new Date(h.at), 'd MMM yyyy, HH:mm:ss')}
                </span>
                <span className="text-gray-600 dark:text-gray-400 sm:col-span-2">{h.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Player skill recalculation and invite cleanup run on the server schedule; ask a developer to
        expose them here if needed.
      </p>
    </div>
  );
}
