import { Routes, Route } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { MemberLayout } from './layout/MemberLayout';
import { PlayerHome } from './pages/PlayerHome';
import { PlayerApp } from './pages/PlayerApp';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminSessionsPage } from './pages/admin/AdminSessionsPage';
import { AdminSessionNewPage } from './pages/admin/AdminSessionNewPage';
import { AdminSessionDetailPage } from './pages/admin/AdminSessionDetailPage';
import { AdminInvitesPage } from './pages/admin/AdminInvitesPage';
import { AdminToolsPage } from './pages/admin/AdminToolsPage';
import { SessionActionPage } from './pages/SessionActionPage';
import { ProfilePage } from './pages/ProfilePage';
import { InviteVerifyPage } from './pages/InviteVerifyPage';

export default function App() {
  return (
    <Routes>
      <Route path="/session-action" element={<SessionActionPage />} />
      <Route path="/invites/verify/:token" element={<InviteVerifyPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="sessions" element={<AdminSessionsPage />} />
          <Route path="sessions/new" element={<AdminSessionNewPage />} />
          <Route path="sessions/:sessionId" element={<AdminSessionDetailPage />} />
          <Route path="invites" element={<AdminInvitesPage />} />
          <Route path="tools" element={<AdminToolsPage />} />
        </Route>
        <Route path="/" element={<MemberLayout />}>
          <Route index element={<PlayerHome />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<PlayerApp />} />
        </Route>
      </Route>
    </Routes>
  );
}
