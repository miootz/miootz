import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { adminRunRecurringNow } from '../../api/adminApi';

export function AdminToolsPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runRecurring() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await adminRunRecurringNow();
      setMessage(
        `Checked ${res.rules_checked} recurrence rule(s); created ${res.sessions_created} new session(s).`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Job failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Tools
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
          Maintenance actions that normally run on a schedule.
        </p>
      </header>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
          Recurring sessions
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Runs the same logic as each rule’s weekly job: create the next meetup if
          missing, then send invite emails with join links. Use after downtime or
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
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Run recurring jobs now
        </button>
      </div>
    </div>
  );
}
