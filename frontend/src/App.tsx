import { Routes, Route } from 'react-router-dom';
import { OverlayLockProvider } from './context/OverlayLock';
import { RequireAuth } from './auth/RequireAuth';
import { MemberLayout } from './layout/MemberLayout';
import { PlayerHome } from './pages/PlayerHome';
import { PlayerApp } from './pages/PlayerApp';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminSessionsPage } from './pages/admin/AdminSessionsPage';
import { AdminSessionNewPage } from './pages/admin/AdminSessionNewPage';
import { AdminSessionDetailPage } from './pages/admin/AdminSessionDetailPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminToolsPage } from './pages/admin/AdminToolsPage';
import { AdminGameTemplatesPage } from './pages/admin/AdminGameTemplatesPage';
import { AdminGameTemplateEditPage } from './pages/admin/AdminGameTemplateEditPage';
import { RefereePage } from './pages/RefereePage';
import { SessionActionPage } from './pages/SessionActionPage';
import { PlusOneClaimPage } from './pages/PlusOneClaimPage';
import { ProfilePage } from './pages/ProfilePage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { HistoryPage } from './pages/HistoryPage';
import { HistorySessionPage } from './pages/HistorySessionPage';

export default function App() {
  return (
    <OverlayLockProvider>
      <Routes>
        <Route path="/plus-one/:token" element={<PlusOneClaimPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/session-action" element={<SessionActionPage />} />
          <Route path="/session-matches/:sessionId" element={<RefereePage />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="sessions" element={<AdminSessionsPage />} />
            <Route path="sessions/new" element={<AdminSessionNewPage />} />
            <Route path="sessions/:sessionId" element={<AdminSessionDetailPage />} />
            <Route path="game-templates" element={<AdminGameTemplatesPage />} />
            <Route path="game-templates/:templateId" element={<AdminGameTemplateEditPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="tools" element={<AdminToolsPage />} />
          </Route>
          <Route path="/" element={<MemberLayout />}>
            <Route index element={<PlayerHome />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="history/:sessionId" element={<HistorySessionPage />} />
            <Route path="*" element={<PlayerApp />} />
          </Route>
        </Route>
      </Routes>
    </OverlayLockProvider>
  );
}
