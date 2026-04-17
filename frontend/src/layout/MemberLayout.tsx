import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  History,
  LayoutGrid,
  Menu,
  Monitor,
  Moon,
  Shield,
  Sun,
  UserCircle,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { setPreferMemberView } from '../auth/memberViewStorage';
import { MemberShellProvider, useMemberShell } from '../context/MemberShellContext';
import { OfflineBanner } from '../components/OfflineBanner';
import { InstallAppBanner } from '../components/InstallAppBanner';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemePreference } from '../theme/themeStorage';

const BOTTOM_NAV_H = '4.5rem';

function ThemeCycleButton() {
  const { preference, setPreference } = useTheme();

  const cycle = () => {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const i = order.indexOf(preference);
    setPreference(order[(i + 1) % order.length]);
  };

  const label =
    preference === 'dark'
      ? 'Dark theme'
      : preference === 'light'
        ? 'Light theme'
        : 'Match system theme';

  const Icon =
    preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor;

  return (
    <button
      type="button"
      onClick={cycle}
      title={label}
      aria-label={`Theme: ${label}. Click to change.`}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:focus:ring-offset-gray-950"
    >
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}

function MemberChrome() {
  const location = useLocation();
  const navigate = useNavigate();
  const { me, loading: authLoading } = useAuth();
  const isAdmin = Boolean(me?.is_admin);
  const { memberView, setMemberView, header } = useMemberShell();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(false);

  useEffect(() => {
    const onUnread = (e: Event) => {
      const d = (e as CustomEvent<{ unread?: boolean }>).detail;
      setChatUnread(!!d?.unread);
    };
    window.addEventListener('footy-chat-unread', onUnread);
    return () => window.removeEventListener('footy-chat-unread', onUnread);
  }, []);

  const isProfile = location.pathname === '/profile';
  const isPlayerHome =
    location.pathname === '/' ||
    (location.pathname !== '/profile' && !location.pathname.startsWith('/admin'));

  const goDetails = () => {
    navigate('/');
    setMemberView('details');
  };

  const goHistory = () => {
    navigate('/');
    setMemberView('history');
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 transition-colors dark:bg-gray-950">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-gray-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:bg-gray-900 dark:focus:text-white"
      >
        Skip to main content
      </a>
      <OfflineBanner />
      <InstallAppBanner />
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-gray-50/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
              Footy Legends
            </p>
            {header ? (
              <>
                <p className="truncate text-base font-semibold text-gray-900 dark:text-white">
                  {header.line1}
                </p>
                {header.line2 && (
                  <p className="truncate text-sm text-gray-600 dark:text-gray-400">
                    {header.line2}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {isProfile ? 'Your profile' : 'Upcoming meetup'}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* sm+: admin + theme */}
            <div className="hidden items-center gap-2 sm:flex">
              {!authLoading && isAdmin && (
                <Link
                  to="/admin"
                  onClick={() => setPreferMemberView(false)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-50 px-3 text-sm font-medium text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40 dark:focus:ring-offset-gray-950"
                >
                  <Shield className="h-4 w-4 shrink-0" aria-hidden />
                  Admin
                </Link>
              )}
              <ThemeCycleButton />
            </div>
            {/* xs: overflow */}
            <div className="relative flex items-center gap-2 sm:hidden">
              <ThemeCycleButton />
              <button
                type="button"
                onClick={() => setOverflowOpen((o) => !o)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                aria-expanded={overflowOpen}
                aria-label="More actions"
              >
                {overflowOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </button>
              {overflowOpen && (
                <div
                  className="absolute right-0 top-full z-50 mt-2 min-w-[12rem] rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      goDetails();
                      setOverflowOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
                    Meetup details
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      goHistory();
                      setOverflowOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    <History className="h-4 w-4 shrink-0" aria-hidden />
                    History
                  </button>
                  <Link
                    to="/profile"
                    role="menuitem"
                    onClick={() => setOverflowOpen(false)}
                    className="flex items-center gap-2 px-4 py-3 text-sm text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    <UserCircle className="h-4 w-4 shrink-0" aria-hidden />
                    Profile
                  </Link>
                  {!authLoading && isAdmin && (
                    <Link
                      to="/admin"
                      role="menuitem"
                      onClick={() => {
                        setPreferMemberView(false);
                        setOverflowOpen(false);
                      }}
                      className="flex items-center gap-2 px-4 py-3 text-sm text-amber-900 hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-950/50"
                    >
                      <Shield className="h-4 w-4 shrink-0" aria-hidden />
                      Admin
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 text-left outline-none"
        style={{
          paddingBottom: `calc(${BOTTOM_NAV_H} + env(safe-area-inset-bottom, 0px))`,
        }}
      >
        <Outlet />
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        aria-label="Member navigation"
      >
        <div className="mx-auto flex max-w-6xl items-stretch justify-around gap-1 px-2 pt-1">
          <button
            type="button"
            onClick={goDetails}
            aria-label={
              chatUnread
                ? 'Details, unread chat messages'
                : 'Details'
            }
            className={`flex min-h-[3.5rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-t-lg px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950 ${
              !isProfile && memberView === 'details' && isPlayerHome
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <span className="relative inline-flex">
              <LayoutGrid className="h-5 w-5 shrink-0" aria-hidden />
              {chatUnread && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-gray-950"
                  aria-hidden
                />
              )}
            </span>
            <span className="truncate">Details</span>
            <span
              className={`h-0.5 w-8 rounded-full ${
                !isProfile && memberView === 'details' && isPlayerHome
                  ? 'bg-violet-600 dark:bg-violet-400'
                  : 'bg-transparent'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={goHistory}
            className={`flex min-h-[3.5rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-t-lg px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950 ${
              !isProfile && memberView === 'history' && isPlayerHome
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <History className="h-5 w-5 shrink-0" aria-hidden />
            <span className="truncate">History</span>
            <span
              className={`h-0.5 w-8 rounded-full ${
                !isProfile && memberView === 'history' && isPlayerHome
                  ? 'bg-violet-600 dark:bg-violet-400'
                  : 'bg-transparent'
              }`}
            />
          </button>
          <Link
            to="/profile"
            className={`flex min-h-[3.5rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-t-lg px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950 ${
              isProfile
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <UserCircle className="h-5 w-5 shrink-0" aria-hidden />
            <span className="truncate">Profile</span>
            <span
              className={`h-0.5 w-8 rounded-full ${
                isProfile ? 'bg-violet-600 dark:bg-violet-400' : 'bg-transparent'
              }`}
            />
          </Link>
        </div>
      </nav>
    </div>
  );
}

export function MemberLayout() {
  return (
    <MemberShellProvider>
      <MemberChrome />
    </MemberShellProvider>
  );
}
