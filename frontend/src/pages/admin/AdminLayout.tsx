import { useEffect, useState } from 'react';
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  Calendar,
  Home,
  LayoutDashboard,
  Mail,
  Menu,
  UserCircle,
  Wrench,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { setPreferMemberView } from '../../auth/memberViewStorage';
import { OfflineBanner } from '../../components/OfflineBanner';
import { AdminNotificationPrompt } from '../../components/admin/AdminNotificationPrompt';

const navCls = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? 'bg-violet-600 text-white shadow-sm'
      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
  }`;

function AdminNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <NavLink to="/admin" end className={navCls} onClick={onNavigate}>
        <LayoutDashboard className="w-4 h-4 shrink-0" />
        Overview
      </NavLink>
      <NavLink to="/admin/sessions" className={navCls} onClick={onNavigate}>
        <Calendar className="w-4 h-4 shrink-0" />
        Sessions
      </NavLink>
      <NavLink to="/admin/invites" className={navCls} onClick={onNavigate}>
        <Mail className="w-4 h-4 shrink-0" />
        Invites
      </NavLink>
      <NavLink to="/admin/tools" className={navCls} onClick={onNavigate}>
        <Wrench className="w-4 h-4 shrink-0" />
        Tools
      </NavLink>
      <NavLink to="/profile" className={navCls} onClick={onNavigate}>
        <UserCircle className="w-4 h-4 shrink-0" />
        Profile
      </NavLink>
    </>
  );
}

export function AdminLayout() {
  const { me, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /** Pathname when the mobile drawer was opened; drawer stays open only while it matches. */
  const [navPathWhenOpened, setNavPathWhenOpened] = useState<string | null>(
    null
  );
  const drawerOpen =
    mobileNavOpen &&
    navPathWhenOpened != null &&
    navPathWhenOpened === location.pathname;

  const openDrawer = () => {
    setNavPathWhenOpened(location.pathname);
    setMobileNavOpen(true);
  };
  const closeDrawer = () => {
    setMobileNavOpen(false);
    setNavPathWhenOpened(null);
  };

  useEffect(() => {
    if (!loading && me && !me.is_admin) {
      navigate('/', { replace: true });
    }
  }, [loading, me, navigate]);

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!me?.is_admin) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable);
      if (e.key === 'Escape' && drawerOpen) {
        e.preventDefault();
        closeDrawer();
        return;
      }
      if (inField) return;
      if (e.key === 'n' || e.key === 'N') {
        if (location.pathname === '/admin/sessions') {
          e.preventDefault();
          navigate('/admin/sessions/new');
        }
      } else if (e.key === '/') {
        e.preventDefault();
        document.getElementById('admin-sessions-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [me?.is_admin, location.pathname, navigate, drawerOpen]);

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
      <a
        href="#admin-main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[120] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-gray-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:bg-gray-900 dark:focus:text-white"
      >
        Skip to main content
      </a>
      <OfflineBanner />

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/95 px-4 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95 md:hidden">
        <button
          type="button"
          onClick={openDrawer}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          aria-expanded={drawerOpen}
          aria-label="Open admin menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            Admin
          </p>
          <p
            className="truncate text-sm font-medium text-gray-900 dark:text-gray-100"
            title={me.user.email}
          >
            {me.user.username}
          </p>
        </div>
        <div className="w-10" aria-hidden />
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 md:min-h-screen shrink-0 flex-col">
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
        <nav className="p-2 flex flex-col gap-1 flex-1">
          <AdminNavLinks />
        </nav>
        <div className="p-4 mt-auto border-t border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-xs text-gray-500 hover:text-violet-600"
          >
            Refresh session
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[100] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
            aria-label="Close menu"
            onClick={closeDrawer}
          />
          <div
            className="absolute left-0 top-0 flex h-full w-[min(20rem,88vw)] flex-col border-r border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-800">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                  Admin
                </p>
                <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {me.user.username}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="border-b border-gray-200 p-4 dark:border-gray-800">
              <Link
                to="/"
                onClick={() => {
                  setPreferMemberView(true);
                  closeDrawer();
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 text-sm font-medium text-gray-800 dark:text-gray-200 hover:border-violet-400 w-full"
              >
                <Home className="w-4 h-4 shrink-0 text-violet-600" aria-hidden />
                Member view
              </Link>
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
              <AdminNavLinks onNavigate={closeDrawer} />
            </nav>
            <div className="border-t border-gray-200 p-4 dark:border-gray-800">
              <button
                type="button"
                onClick={() => void refresh()}
                className="text-xs text-gray-500 hover:text-violet-600"
              >
                Refresh session
              </button>
            </div>
          </div>
        </div>
      )}

      <main
        id="admin-main-content"
        tabIndex={-1}
        className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 outline-none"
        style={{
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <AdminNotificationPrompt />
        <Outlet />
      </main>
    </div>
  );
}
