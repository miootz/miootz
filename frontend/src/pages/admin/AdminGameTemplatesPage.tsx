import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight, Loader2, Play, Plus, Repeat } from 'lucide-react';
import {
  adminListGameTemplates,
  adminUpdateGameTemplate,
  type GameTemplateRow,
} from '../../api/adminApi';
import { AdminBreadcrumb } from '../../components/admin/AdminBreadcrumb';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import { useToast } from '../../context/ToastContext';

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

  const { showToast } = useToast();
  const [activating, setActivating] = useState<number | null>(null);

  async function activate(id: number) {
    setActivating(id);
    try {
      await adminUpdateGameTemplate(id, { is_active: true });
      showToast('Template activated.', 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to activate', 'error');
    } finally {
      setActivating(null);
    }
  }

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
        title="Templates"
        subtitle="The active template defines how new meetups are created and schedules them automatically. Add and manage extra templates here."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          The active template drives the job that materializes the next meetup
          and sends push notifications.
        </p>
        <Link
          to="/admin/game-templates/new"
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800"
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
          <Loader2 className="w-8 h-8 animate-spin text-teal-700" aria-label="Loading" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-8">
          No templates yet. Create one to schedule meetups automatically.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.id}>
              <div
                className={`relative flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-colors ${
                  t.is_active
                    ? 'border-teal-400 dark:border-teal-700 bg-teal-50 dark:bg-teal-950/30 ring-1 ring-teal-400/40 dark:ring-teal-700/40'
                    : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
                }`}
              >
                <Link to={`/admin/game-templates/${t.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {t.name}
                    </span>
                    {t.is_active && (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-teal-700 text-white px-2 py-0.5 text-2xs font-semibold">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                    <span className="inline-flex items-center gap-1">
                      <Repeat className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      {t.is_active ? 'Scheduling meetups' : 'Paused'}
                    </span>
                    {t.materialized_meetup_count != null && (
                      <span>
                        {t.materialized_meetup_count} meetup
                        {t.materialized_meetup_count === 1 ? '' : 's'} linked
                      </span>
                    )}
                    <span className="truncate">{t.location}</span>
                  </div>
                </Link>
                {t.is_active ? (
                  <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" aria-hidden />
                ) : (
                  <button
                    type="button"
                    onClick={() => void activate(t.id)}
                    disabled={activating === t.id}
                    className="shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 disabled:opacity-60 transition-colors"
                  >
                    {activating === t.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Play className="w-3.5 h-3.5" aria-hidden />
                    )}
                    Activate
                  </button>
                )}
              </div>
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
