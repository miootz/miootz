import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Calendar,
  Home,
  LayoutDashboard,
  Mail,
  UserCircle,
  Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { setPreferMemberView } from '../../auth/memberViewStorage';

const navCls = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? 'bg-violet-600 text-white shadow-sm'
      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
  }`;

export function AdminLayout() {
  const { me, loading, refresh } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && me && !me.is_admin) {
      navigate('/', { replace: true });
    }
  }, [loading, me, navigate]);

  if (loading || !me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 border-2 border-violet-600 border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading…</p>
        </div>
      </div>
    );
  }

  if (!me.is_admin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col md:flex-row">
      <aside className="md:w-56 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 md:min-h-screen shrink-0">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <Link
            to="/"
            onClick={() => setPreferMemberView(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 text-sm font-medium text-gray-800 dark:text-gray-200 hover:border-violet-400 hover:bg-white dark:hover:bg-gray-800 transition-colors w-full"
          >
            <Home className="w-4 h-4 shrink-0 text-violet-600" aria-hidden />
            <span className="text-left">
              <span className="block">Member view</span>
              <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                Player home & meetups
              </span>
            </span>
          </Link>
          <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <span className="text-violet-600">Admin</span>
          </h2>
          <p className="text-xs text-gray-500 truncate mt-1" title={me.user.email}>
            {me.user.username}
          </p>
        </div>
        <nav className="p-2 flex md:flex-col gap-1 overflow-x-auto">
          <NavLink to="/admin" end className={navCls}>
            <LayoutDashboard className="w-4 h-4 shrink-0" />
            Overview
          </NavLink>
          <NavLink to="/admin/sessions" className={navCls}>
            <Calendar className="w-4 h-4 shrink-0" />
            Sessions
          </NavLink>
          <NavLink to="/admin/invites" className={navCls}>
            <Mail className="w-4 h-4 shrink-0" />
            Invites
          </NavLink>
          <NavLink to="/admin/tools" className={navCls}>
            <Wrench className="w-4 h-4 shrink-0" />
            Tools
          </NavLink>
          <NavLink to="/profile" className={navCls}>
            <UserCircle className="w-4 h-4 shrink-0" />
            Profile
          </NavLink>
        </nav>
        <div className="hidden md:block p-4 mt-auto border-t border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-xs text-gray-500 hover:text-violet-600"
          >
            Refresh session
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
