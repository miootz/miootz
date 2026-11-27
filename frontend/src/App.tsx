import { Component, lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { matchPath, Outlet, Routes, Route, useLocation } from 'react-router-dom';
import { OverlayLockProvider } from './context/OverlayLock';
import { RequireAuth } from './auth/RequireAuth';
import { MemberLayout } from './layout/MemberLayout';
import { demoRoom } from './utils/demoRoom';
import { PlayerHome } from './pages/PlayerHome';
import { PlayerApp } from './pages/PlayerApp';

const routePreloads: Array<{ path: string; load: () => Promise<unknown> }> = [];

function lazyRoute(path: string, importPage: () => Promise<{ default: ComponentType }>) {
  let pending: ReturnType<typeof importPage> | undefined;
  function load() {
    return pending ??= importPage().catch((error) => {
      pending = undefined;
      throw error;
    });
  }
  routePreloads.push({ path, load });
  return lazy(load);
}

function preloadLinkedRoute(event: Event) {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>('a[href]');
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const url = new URL(link.href);
  if (url.origin !== window.location.origin) return;
  const room = demoRoom();
  if (room && url.pathname !== room && !url.pathname.startsWith(`${room}/`)) return;
  const pathname = url.pathname.slice(room.length) || '/';
  if (pathname === window.location.pathname.slice(room.length)) return;

  // Exact pages take priority over parametric siblings (e.g. /meetups/new).
  const page = routePreloads.find((route) => route.path === pathname) ??
    routePreloads.find((route) => !route.path.endsWith('/*') && matchPath(route.path, pathname));
  const layout = routePreloads.find((route) => route.path.endsWith('/*') && matchPath(route.path, pathname));
  for (const route of [layout, page]) void route?.load().catch(() => {});
}

function RoutePending() {
  return <p role="status" className="p-4 text-sm text-ink-dim">Loading page…</p>;
}

function RouteOutlet() {
  return <Suspense fallback={<RoutePending />}><Outlet /></Suspense>;
}

const AdminLayout = lazyRoute('/admin/*', () =>
  import('./pages/admin/AdminLayout').then(({ AdminLayout }) => ({ default: AdminLayout })),
);
const AdminDashboard = lazyRoute('/admin', () =>
  import('./pages/admin/AdminDashboard').then(({ AdminDashboard }) => ({ default: AdminDashboard })),
);
const AdminMeetupsPage = lazyRoute('/admin/meetups', () =>
  import('./pages/admin/AdminMeetupsPage').then(({ AdminMeetupsPage }) => ({ default: AdminMeetupsPage })),
);
const AdminMeetupNewPage = lazyRoute('/admin/meetups/new', () =>
  import('./pages/admin/AdminMeetupNewPage').then(({ AdminMeetupNewPage }) => ({ default: AdminMeetupNewPage })),
);
const AdminMeetupDetailPage = lazyRoute('/admin/meetups/:meetupId', () =>
  import('./pages/admin/AdminMeetupDetailPage').then(({ AdminMeetupDetailPage }) => ({ default: AdminMeetupDetailPage })),
);
const AdminPlayersPage = lazyRoute('/admin/players', () =>
  import('./pages/admin/AdminPlayersPage').then(({ AdminPlayersPage }) => ({ default: AdminPlayersPage })),
);
const AdminPlayerDetailPage = lazyRoute('/admin/players/:userId', () =>
  import('./pages/admin/AdminPlayerDetailPage').then(({ AdminPlayerDetailPage }) => ({ default: AdminPlayerDetailPage })),
);
const AdminToolsPage = lazyRoute('/admin/tools', () =>
  import('./pages/admin/AdminToolsPage').then(({ AdminToolsPage }) => ({ default: AdminToolsPage })),
);
const AdminAuditPage = lazyRoute('/admin/audit', () =>
  import('./pages/admin/AdminAuditPage').then(({ AdminAuditPage }) => ({ default: AdminAuditPage })),
);
const AdminGameTemplatesPage = lazyRoute('/admin/game-templates', () =>
  import('./pages/admin/AdminGameTemplatesPage').then(({ AdminGameTemplatesPage }) => ({ default: AdminGameTemplatesPage })),
);
const AdminGameTemplateEditPage = lazyRoute('/admin/game-templates/:templateId', () =>
  import('./pages/admin/AdminGameTemplateEditPage').then(({ AdminGameTemplateEditPage }) => ({ default: AdminGameTemplateEditPage })),
);
const RefereePage = lazyRoute('/meetup-matches/:meetupId/:matchId?', () =>
  import('./pages/RefereePage').then(({ RefereePage }) => ({ default: RefereePage })),
);
const MeetupActionPage = lazyRoute('/meetup-action', () =>
  import('./pages/MeetupActionPage').then(({ MeetupActionPage }) => ({ default: MeetupActionPage })),
);
const MeetupReservationPage = lazyRoute('/meetup-reservation', () =>
  import('./pages/MeetupActionPage').then(({ MeetupReservationPage }) => ({ default: MeetupReservationPage })),
);
const PlusOneClaimPage = lazyRoute('/plus-one/:token', () =>
  import('./pages/PlusOneClaimPage').then(({ PlusOneClaimPage }) => ({ default: PlusOneClaimPage })),
);
const MeetupChatPage = lazyRoute('/meetups/:meetupId/chat', () => import("./pages/MeetupChatPage"));
const ProfilePage = lazyRoute('/profile', () =>
  import('./pages/ProfilePage').then(({ ProfilePage }) => ({ default: ProfilePage })),
);
const AuthCallbackPage = lazyRoute('/auth/callback', () =>
  import('./pages/AuthCallbackPage').then(({ AuthCallbackPage }) => ({ default: AuthCallbackPage })),
);
const HistoryPage = lazyRoute('/history', () =>
  import('./pages/HistoryPage').then(({ HistoryPage }) => ({ default: HistoryPage })),
);
const HistoryMeetupPage = lazyRoute('/history/:meetupId', () =>
  import('./pages/HistoryMeetupPage').then(({ HistoryMeetupPage }) => ({ default: HistoryMeetupPage })),
);
const RankingsPage = lazyRoute('/rankings', () =>
  import('./pages/RankingsPage').then(({ RankingsPage }) => ({ default: RankingsPage })),
);

export class RouteLoadBoundary extends Component<
  { children: ReactNode; pathname: string },
  { failed: boolean; pathname: string }
> {
  state = { failed: false, pathname: this.props.pathname };

  static getDerivedStateFromProps(props: { pathname: string }, state: { pathname: string }) {
    return props.pathname === state.pathname ? null : { failed: false, pathname: props.pathname };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <main role="alert" className="grid flex-1 min-h-0 place-items-center bg-board p-6 text-center">
          <div className="space-y-4">
            <p className="text-ink">This page could not be loaded.</p>
            <button type="button" onClick={() => window.location.reload()} className="bg-ink px-4 py-3 font-bold text-board">
              Reload
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    const events = ['pointerover', 'pointerdown', 'focusin'];
    for (const event of events) document.addEventListener(event, preloadLinkedRoute);
    return () => {
      for (const event of events) document.removeEventListener(event, preloadLinkedRoute);
    };
  }, []);

  return (
    <OverlayLockProvider>
      <RouteLoadBoundary pathname={pathname}>
        <Suspense fallback={<RoutePending />}>
          <Routes>
            <Route path="/plus-one/:token" element={<PlusOneClaimPage />} />
            <Route path="/meetup-reservation" element={<MeetupReservationPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/meetup-action" element={<MeetupActionPage />} />
              <Route path="/meetup-matches/:meetupId/:matchId?" element={<RefereePage />} />
              <Route path="/admin" element={<AdminLayout />}>
                <Route element={<RouteOutlet />}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="meetups" element={<AdminMeetupsPage />} />
                  <Route path="meetups/new" element={<AdminMeetupNewPage />} />
                  <Route path="meetups/:meetupId" element={<AdminMeetupDetailPage />} />
                  <Route path="game-templates" element={<AdminGameTemplatesPage />} />
                  <Route path="game-templates/:templateId" element={<AdminGameTemplateEditPage />} />
                  <Route path="players" element={<AdminPlayersPage />} />
                  <Route path="players/:userId" element={<AdminPlayerDetailPage />} />
                  <Route path="tools" element={<AdminToolsPage />} />
                  <Route path="audit" element={<AdminAuditPage />} />
                </Route>
              </Route>
              <Route path="/" element={<MemberLayout />}>
                <Route element={<RouteOutlet />}>
                  <Route index element={<PlayerHome />} />
                  <Route path="meetups/:meetupId/chat" element={<MeetupChatPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="history" element={<HistoryPage />} />
                  <Route path="history/:meetupId" element={<HistoryMeetupPage />} />
                  <Route path="rankings" element={<RankingsPage />} />
                  <Route path="*" element={<PlayerApp />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </RouteLoadBoundary>
    </OverlayLockProvider>
  );
}
