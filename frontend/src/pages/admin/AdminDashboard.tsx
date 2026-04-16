import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Mail, Plus, Wrench } from 'lucide-react';
import { fetchSessions } from '../../api/sessionsApi';

export function AdminDashboard() {
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let c = true;
    (async () => {
      try {
        const list = await fetchSessions();
        if (c) setCount(list.length);
      } catch (e) {
        if (c) setErr(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
    return () => {
      c = false;
    };
  }, []);

  const cards = [
    {
      to: '/admin/sessions',
      title: 'Sessions',
      desc: 'Create, edit, delete meetups; manage attendance.',
      icon: Calendar,
      stat: count !== null ? `${count} scheduled` : err ? '—' : '…',
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
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
          Overview
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Manage Footy Legends sessions, invites, and background tasks.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ to, title, desc, icon: Icon, stat }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm hover:border-violet-400 dark:hover:border-violet-600 hover:shadow-md transition-all"
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

      <div className="mt-8 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center">
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
