import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { fetchSessions, type SessionListItem } from '../../api/sessionsApi';
import { parseSessionStart } from '../../utils/datetime';
import { adminDeleteSession } from '../../api/adminApi';

export function AdminSessionsPage() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await fetchSessions();
      setSessions(
        [...list].sort(
          (a, b) =>
            parseSessionStart(a.start_time).getTime() -
            parseSessionStart(b.start_time).getTime()
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(id: number) {
    if (
      !window.confirm(
        'Delete this session permanently? This cannot be undone.'
      )
    ) {
      return;
    }
    setDeletingId(id);
    try {
      await adminDeleteSession(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-gray-600 dark:text-gray-400">
        Loading sessions…
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Sessions
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Create and manage meetups, attendance, and waitlists.
          </p>
        </div>
        <Link
          to="/admin/sessions/new"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          New session
        </Link>
      </div>

      {error && (
        <div
          className="mb-6 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
          <Calendar className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            No sessions yet. Create the first one.
          </p>
          <Link
            to="/admin/sessions/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700"
          >
            <Plus className="w-4 h-4" />
            Create session
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden flex flex-col sm:flex-row sm:items-stretch"
            >
              <Link
                to={`/admin/sessions/${s.id}`}
                className="flex-1 flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors min-w-0"
              >
                <div className="rounded-lg bg-violet-100 dark:bg-violet-950 p-2 text-violet-700 dark:text-violet-300 shrink-0">
                  <Calendar className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                    {s.location}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {format(parseSessionStart(s.start_time), 'PPp')} · {s.min_players}–
                    {s.max_players} players · {s.waitlist_mode}
                    {s.recurrence_rule_id != null ? (
                      <span className="ml-2 text-violet-600 dark:text-violet-400">
                        · Weekly rule
                      </span>
                    ) : null}
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />
              </Link>
              <div className="flex sm:flex-col border-t sm:border-t-0 sm:border-l border-gray-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => void handleDelete(s.id)}
                  disabled={deletingId === s.id}
                  className="flex-1 sm:w-14 flex items-center justify-center gap-2 px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                  aria-label={`Delete session ${s.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="sm:hidden">Delete</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
