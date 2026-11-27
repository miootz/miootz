import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { OverlayLockProvider } from './context/OverlayLock';
import { RequireAuth } from './auth/RequireAuth';
import { MemberLayout } from './layout/MemberLayout';
import { AppSplash } from './components/AppSplash';
import { PlayerHome } from './pages/PlayerHome';
import { PlayerApp } from './pages/PlayerApp';

const AdminLayout = lazy(() =>
  import('./pages/admin/AdminLayout').then(({ AdminLayout }) => ({ default: AdminLayout })),
);
const AdminDashboard = lazy(() =>
  import('./pages/admin/AdminDashboard').then(({ AdminDashboard }) => ({ default: AdminDashboard })),
);
const AdminMeetupsPage = lazy(() =>
  import('./pages/admin/AdminMeetupsPage').then(({ AdminMeetupsPage }) => ({ default: AdminMeetupsPage })),
);
const AdminMeetupNewPage = lazy(() =>
  import('./pages/admin/AdminMeetupNewPage').then(({ AdminMeetupNewPage }) => ({ default: AdminMeetupNewPage })),
);
const AdminMeetupDetailPage = lazy(() =>
  import('./pages/admin/AdminMeetupDetailPage').then(({ AdminMeetupDetailPage }) => ({ default: AdminMeetupDetailPage })),
);
const AdminPlayersPage = lazy(() =>
  import('./pages/admin/AdminPlayersPage').then(({ AdminPlayersPage }) => ({ default: AdminPlayersPage })),
);
const AdminPlayerDetailPage = lazy(() =>
  import('./pages/admin/AdminPlayerDetailPage').then(({ AdminPlayerDetailPage }) => ({ default: AdminPlayerDetailPage })),
);
const AdminToolsPage = lazy(() =>
  import('./pages/admin/AdminToolsPage').then(({ AdminToolsPage }) => ({ default: AdminToolsPage })),
);
const AdminAuditPage = lazy(() =>
  import('./pages/admin/AdminAuditPage').then(({ AdminAuditPage }) => ({ default: AdminAuditPage })),
);
const AdminGameTemplatesPage = lazy(() =>
  import('./pages/admin/AdminGameTemplatesPage').then(({ AdminGameTemplatesPage }) => ({ default: AdminGameTemplatesPage })),
);
const AdminGameTemplateEditPage = lazy(() =>
  import('./pages/admin/AdminGameTemplateEditPage').then(({ AdminGameTemplateEditPage }) => ({ default: AdminGameTemplateEditPage })),
);
const RefereePage = lazy(() =>
  import('./pages/RefereePage').then(({ RefereePage }) => ({ default: RefereePage })),
);
const MeetupActionPage = lazy(() =>
  import('./pages/MeetupActionPage').then(({ MeetupActionPage }) => ({ default: MeetupActionPage })),
);
const MeetupReservationPage = lazy(() =>
  import('./pages/MeetupActionPage').then(({ MeetupReservationPage }) => ({ default: MeetupReservationPage })),
);
const PlusOneClaimPage = lazy(() =>
  import('./pages/PlusOneClaimPage').then(({ PlusOneClaimPage }) => ({ default: PlusOneClaimPage })),
);
const MeetupChatPage = lazy(() => import("./pages/MeetupChatPage"));
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then(({ ProfilePage }) => ({ default: ProfilePage })),
);
const AuthCallbackPage = lazy(() =>
  import('./pages/AuthCallbackPage').then(({ AuthCallbackPage }) => ({ default: AuthCallbackPage })),
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then(({ HistoryPage }) => ({ default: HistoryPage })),
);
const HistoryMeetupPage = lazy(() =>
  import('./pages/HistoryMeetupPage').then(({ HistoryMeetupPage }) => ({ default: HistoryMeetupPage })),
);
const RankingsPage = lazy(() =>
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
  return (
    <OverlayLockProvider>
      <RouteLoadBoundary pathname={pathname}>
        <Suspense fallback={<AppSplash status="Loading page…" />}>
          <Routes>
            <Route path="/plus-one/:token" element={<PlusOneClaimPage />} />
            <Route path="/meetup-reservation" element={<MeetupReservationPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/meetup-action" element={<MeetupActionPage />} />
              <Route path="/meetup-matches/:meetupId/:matchId?" element={<RefereePage />} />
              <Route path="/admin" element={<AdminLayout />}>
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
              <Route path="/" element={<MemberLayout />}>
                <Route index element={<PlayerHome />} />
                <Route path="meetups/:meetupId/chat" element={<MeetupChatPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="history/:meetupId" element={<HistoryMeetupPage />} />
                <Route path="rankings" element={<RankingsPage />} />
                <Route path="*" element={<PlayerApp />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </RouteLoadBoundary>
    </OverlayLockProvider>
  );
}
