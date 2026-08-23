import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  History,
  LayoutGrid,
  Menu,
  Shield,
  UserCircle,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { setPreferMemberView } from '../auth/memberViewStorage';
import { useOnlineStatus } from '../offline/useOnlineStatus';
import { MemberShellProvider, useMemberShell } from '../context/MemberShellContext';
import { OfflineBanner } from '../components/OfflineBanner';
import { InstallAppBanner } from '../components/InstallAppBanner';
import { MemberNotificationPrompt } from '../components/MemberNotificationPrompt';
import { MeetupWeatherBadge } from '../components/MeetupWeatherBadge';

const BOTTOM_NAV_H = '4.5rem';

function SseIndicator({ live }: { live: boolean }) {
  return (
    <span className="ml-1.5 inline-flex items-center" aria-hidden>
      {live ? (
        <span className="relative block h-2 w-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative block h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      ) : (
        <WifiOff className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
      )}
    </span>
  );
}

function MemberChrome() {
  const location = useLocation();
  const navigate = useNavigate();
  const { me, loading: authLoading } = useAuth();
  const isAdmin = Boolean(me?.is_admin);
  const online = useOnlineStatus();
  const { header } = useMemberShell();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(false);

  useEffect(() => {
    const onUnread = (e: Event) => {
      const d = (e as CustomEvent<{ unread?: boolean }>).detail;
      setChatUnread(!!d?.unread);
    };
    window.addEventListener('miootz-chat-unread', onUnread);
    return () => window.removeEventListener('miootz-chat-unread', onUnread);
  }, []);

  const isProfile = location.pathname === '/profile';
  const isHistory = location.pathname.startsWith('/history');
  const isPlayerHome =
    location.pathname === '/' ||
    (location.pathname !== '/profile' && !location.pathname.startsWith('/admin') && !isHistory);

  const goDetails = () => {
    navigate('/');
  };

  const goHistory = () => {
    navigate('/history');
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
      <InstallAppBanner enabled={online} />
      <MemberNotificationPrompt enabled={online} />
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-gray-50/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
              Miootz
              {isAdmin && (
                <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  Player view
                </span>
              )}
              {header?.sseLive != null && <SseIndicator live={header.sseLive} />}
            </p>
            {header ? (
              <>
                <p className="text-base font-semibold text-gray-900 dark:text-white">
                  {header.line1}
                </p>
                {(header.location != null || header.fee != null || header.sessionId != null) && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-gray-600 dark:text-gray-400">
                    {header.location != null && (
                      <span className="truncate max-w-[min(100%,20rem)]">{header.location}</span>
                    )}
                    {header.location != null && (header.fee != null || header.sessionId != null) && (
                      <span className="shrink-0 text-gray-400 dark:text-gray-500">&middot;</span>
                    )}
                    {header.fee != null && header.fee > 0 && (
                      <span className="shrink-0 font-medium text-gray-800 dark:text-gray-200">
                        ${header.fee.toFixed(0)}
                      </span>
                    )}
                    {header.fee != null && header.fee > 0 && header.sessionId != null && (
                      <span className="shrink-0 text-gray-400 dark:text-gray-500">&middot;</span>
                    )}
                    {header.sessionId != null && (
                      <MeetupWeatherBadge sessionId={header.sessionId} />
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {isProfile ? 'Your profile' : 'Upcoming meetup'}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* sm+: admin */}
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
            </div>
            {/* xs: overflow */}
            <div className="relative flex items-center gap-2 sm:hidden">
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
                    Meetup
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
                ? 'Meetup, unread chat messages'
                : 'Meetup'
            }
            className={`flex min-h-[3.5rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-t-lg px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950 ${
              isPlayerHome
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
            <span className="truncate">Meetup</span>
            <span
              className={`h-0.5 w-8 rounded-full ${
              isPlayerHome
                  ? 'bg-violet-600 dark:bg-violet-400'
                  : 'bg-transparent'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={goHistory}
            className={`flex min-h-[3.5rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-t-lg px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950 ${
              isHistory
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <History className="h-5 w-5 shrink-0" aria-hidden />
            <span className="truncate">History</span>
            <span
              className={`h-0.5 w-8 rounded-full ${
                isHistory
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
