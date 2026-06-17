import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight, Loader2, Plus, Repeat } from 'lucide-react';
import {
  adminListGameTemplates,
  type GameTemplateRow,
} from '../../api/adminApi';
import { AdminBreadcrumb } from '../../components/admin/AdminBreadcrumb';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader';

export function AdminGameTemplatesPage() {
  const [items, setItems] = useState<GameTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await adminListGameTemplates();
      setItems(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <AdminPageHeader
        breadcrumb={
          <AdminBreadcrumb
            items={[{ label: 'Admin', to: '/admin' }, { label: 'Game templates' }]}
          />
        }
        title="Game templates"
        subtitle="Weekly schedules and defaults for auto-created meetups. Session pages only edit individual meetups."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Templates drive the cron job that materializes the next session and sends push notifications.
        </p>
        <Link
          to="/admin/game-templates/new"
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
        >
          <Plus className="w-4 h-4" />
          New template
        </Link>
      </div>

      {error && (
        <div
          className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-800 dark:text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600" aria-label="Loading" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-8">
          No templates yet. Create one to enable weekly auto-sessions.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.id}>
              <Link
                to={`/admin/game-templates/${t.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 hover:border-violet-400 dark:hover:border-violet-600 transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                    {t.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                    <span className="inline-flex items-center gap-1">
                      <Repeat className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      {t.is_active ? 'Active' : 'Paused'}
                    </span>
                    {t.materialized_session_count != null && (
                      <span>
                        {t.materialized_session_count} session
                        {t.materialized_session_count === 1 ? '' : 's'} linked
                      </span>
                    )}
                    <span className="truncate">{t.location}</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-2">
        <CalendarClock className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
        Use Tools → “Run recurring jobs now” to test materialization without waiting for the weekly cron.
      </p>
    </div>
  );
}
