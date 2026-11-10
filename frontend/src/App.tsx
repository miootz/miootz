import { Routes, Route } from 'react-router-dom';
import { OverlayLockProvider } from './context/OverlayLock';
import { RequireAuth } from './auth/RequireAuth';
import { MemberLayout } from './layout/MemberLayout';
import { PlayerHome } from './pages/PlayerHome';
import { PlayerApp } from './pages/PlayerApp';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminMeetupsPage } from './pages/admin/AdminMeetupsPage';
import { AdminMeetupNewPage } from './pages/admin/AdminMeetupNewPage';
import { AdminMeetupDetailPage } from './pages/admin/AdminMeetupDetailPage';
import { AdminPlayersPage } from './pages/admin/AdminPlayersPage';
import { AdminPlayerDetailPage } from './pages/admin/AdminPlayerDetailPage';
import { AdminToolsPage } from './pages/admin/AdminToolsPage';
import { AdminAuditPage } from './pages/admin/AdminAuditPage';
import { AdminGameTemplatesPage } from './pages/admin/AdminGameTemplatesPage';
import { AdminGameTemplateEditPage } from './pages/admin/AdminGameTemplateEditPage';
import { RefereePage } from './pages/RefereePage';
import { MeetupActionPage } from './pages/MeetupActionPage';
import { PlusOneClaimPage } from './pages/PlusOneClaimPage';
import { ProfilePage } from './pages/ProfilePage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { HistoryPage } from './pages/HistoryPage';
import { HistoryMeetupPage } from './pages/HistoryMeetupPage';
import { RankingsPage } from './pages/RankingsPage';

export default function App() {
  return (
    <OverlayLockProvider>
      <Routes>
        <Route path="/plus-one/:token" element={<PlusOneClaimPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/meetup-action" element={<MeetupActionPage />} />
          <Route path="/meetup-matches/:meetupId" element={<RefereePage />} />
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
            <Route path="profile" element={<ProfilePage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="history/:meetupId" element={<HistoryMeetupPage />} />
            <Route path="rankings" element={<RankingsPage />} />
            <Route path="*" element={<PlayerApp />} />
          </Route>
        </Route>
      </Routes>
    </OverlayLockProvider>
  );
}
