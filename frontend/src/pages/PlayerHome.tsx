import { Navigate, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../auth/useAuth';
import { getPreferMemberView } from '../auth/memberViewStorage';
import { PlayerApp } from './PlayerApp';
import { roomStorageKey } from '../utils/demoRoom';

const PENDING_ACTION_KEY = roomStorageKey('miootz_pending_action');

/**
 * `/` — admins default to `/admin` unless they chose the member (player) home.
 * Also checks for a pending push-notification action and redirects to it.
 */
export function PlayerHome() {
  const { me, loading } = useAuth();
  const navigate = useNavigate();

  // After auth resolves, check for a pending push-notification action
  useEffect(() => {
    if (loading) return;
    if (!me) return;
    try {
      const raw = sessionStorage.getItem(PENDING_ACTION_KEY);
      if (!raw) return;
      const pending = JSON.parse(raw);
      sessionStorage.removeItem(PENDING_ACTION_KEY);
      const { meetupId, action } = pending;
      if (meetupId && action) {
        navigate(`/meetup-action?mid=${meetupId}&act=${action}`, { replace: true });
      }
    } catch {
      /* ignore corrupt data */
    }
  }, [me, loading, navigate]);

  if (me?.is_admin && !getPreferMemberView()) {
    return <Navigate to="/admin" replace />;
  }

  return <PlayerApp />;
}
