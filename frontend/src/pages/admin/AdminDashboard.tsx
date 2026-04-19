import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Mail, Plus, Repeat, Wrench } from 'lucide-react';
import { adminListGameTemplates } from '../../api/adminApi';
import { fetchSessions } from '../../api/sessionsApi';
import { AdminBreadcrumb } from '../../components/admin/AdminBreadcrumb';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader';

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800/50 p-5 h-36"
        />
      ))}
    </div>
  );
}

export function AdminDashboard() {
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [templateCount, setTemplateCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let c = true;
    (async () => {
      try {
        const [data, gt] = await Promise.all([
          fetchSessions(),
          adminListGameTemplates(),
        ]);
        if (c) {
          setSessionCount(data.total);
          setTemplateCount(gt.items.length);
        }
      } catch (e) {
        if (c) setErr(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
    return () => {
      c = false;
    };
  }, []);

  const loading = sessionCount === null && templateCount === null && !err;

  const cards = [
    {
      to: '/admin/sessions',
      title: 'Sessions',
      desc: 'Create, edit, delete meetups; manage attendance.',
      icon: Calendar,
      stat:
        sessionCount !== null
          ? `${sessionCount} scheduled`
          : err
            ? '—'
            : '…',
    },
    {
      to: '/admin/game-templates',
      title: 'Templates',
      desc: 'Weekly schedules and defaults for auto-created meetups.',
      icon: Repeat,
      stat:
        templateCount !== null
          ? `${templateCount} template${templateCount === 1 ? '' : 's'}`
          : err
            ? '—'
            : '…',
    },
    {
      to: '/admin/invites',
      title: 'Invites',
      desc: 'Generate email invite links for new players.',
      icon: Mail,
      stat: '7-day links',
    },
    {
      to: '/admin/tools',
      title: 'Tools',
      desc: 'Run recurring session jobs manually (catch-up / test).',
      icon: Wrench,
      stat: 'Maintenance',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <AdminPageHeader
        breadcrumb={
          <AdminBreadcrumb
            items={[{ label: 'Admin', to: '/admin' }, { label: 'Overview' }]}
          />
        }
        title="Overview"
        subtitle="Sessions are individual meetups; templates define weekly auto-sessions."
      />

      {loading ? (
        <DashboardSkeleton />
      ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ to, title, desc, icon: Icon, stat }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-2xl border border-gray-200 dark:border-gray-800 bg-gradient-to-br from-violet-50/50 to-white dark:from-violet-950/20 dark:to-gray-900 p-5 shadow-sm hover:border-violet-400 dark:hover:border-violet-600 hover:shadow-md transition-all active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="rounded-lg bg-violet-100 dark:bg-violet-950 p-2 text-violet-700 dark:text-violet-300">
                <Icon className="w-5 h-5" aria-hidden />
              </div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {stat}
              </span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100 group-hover:text-violet-600 dark:group-hover:text-violet-400">
              {title}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{desc}</p>
          </Link>
        ))}
      </div>
      )}

      <div className="mt-8 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center transition-colors">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Need a new meetup?
        </p>
        <Link
          to="/admin/sessions/new"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New session
        </Link>
      </div>
    </div>
  );
}
