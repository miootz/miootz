import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar, Plus, Repeat, Users, Wrench } from 'lucide-react';
import { adminListGameTemplates } from '../../api/adminApi';
import { fetchSessionDetail, fetchSessions } from '../../api/sessionsApi';
import { parseSessionStart } from '../../utils/datetime';
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
  const [nextSession, setNextSession] = useState<{
    id: number;
    start_time: string;
    location: string;
    confirmed: number;
    max: number;
    min: number;
    waitlistCount: number;
  } | null>(null);
  const [nextAnnounceAt, setNextAnnounceAt] = useState<string | null>(null);

  useEffect(() => {
    let c = true;
    (async () => {
      try {
        const [data, gt, upcoming] = await Promise.all([
          fetchSessions(),
          adminListGameTemplates(),
          fetchSessions({ status: 'upcoming', order: 'asc', limit: 1 }),
        ]);
        if (!c) return;
        setSessionCount(data.total);
        setTemplateCount(gt.items.length);

        const next = upcoming.items[0];
        if (next) {
          let waitlistCount = 0;
          try {
            const detail = await fetchSessionDetail(next.id);
            if (!c) return;
            waitlistCount = detail.attendees.filter(
              (a) => a.status === 'waitlisted'
            ).length;
          } catch {
            /* waitlist depth is optional */
          }
          setNextSession({
            id: next.id,
            start_time: next.start_time,
            location: next.location,
            confirmed: next.confirmed_count ?? 0,
            max: next.max_players,
            min: next.min_players,
            waitlistCount,
          });
        } else {
          // No upcoming session — surface the next signups-open time
          const past = await fetchSessions({
            status: 'all',
            order: 'desc',
            limit: 5,
          });
          if (!c) return;
          setNextAnnounceAt(
            past.items.find((x) => x.game_template?.next_announce_at)
              ?.game_template?.next_announce_at ?? null
          );
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
      to: '/admin/users',
      title: 'Users',
      desc: 'Manage players, edit profiles, and generate invite links.',
      icon: Users,
      stat: 'Player roster',
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

      {!loading && (
        <section className="mb-6 rounded-2xl border border-violet-200 dark:border-violet-900/60 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-gray-900 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                Next meetup
              </p>
              {nextSession ? (
                <>
                  <h2 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
                    {format(
                      parseSessionStart(nextSession.start_time),
                      'EEEE, d MMMM · HH:mm'
                    )}
                  </h2>
                  <p className="mt-0.5 truncate text-sm text-gray-600 dark:text-gray-400">
                    {nextSession.location}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {nextSession.confirmed}/{nextSession.max} confirmed
                    </span>
                    {nextSession.confirmed < nextSession.min && (
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        Below min players ({nextSession.min})
                      </span>
                    )}
                    {nextSession.waitlistCount > 0 && (
                      <span className="text-gray-500 dark:text-gray-400">
                        {nextSession.waitlistCount} waitlisted
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <h2 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
                    No upcoming meetup
                  </h2>
                  <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                    {nextAnnounceAt
                      ? `Signups open ${format(new Date(nextAnnounceAt), 'EEEE, HH:mm')}`
                      : 'Create one below to get started.'}
                  </p>
                </>
              )}
            </div>
            <Link
              to="/admin/sessions/new"
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 font-medium text-white hover:bg-violet-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New session
            </Link>
          </div>
        </section>
      )}

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
