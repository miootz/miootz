import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { getPreferMemberView } from '../auth/memberViewStorage';
import { PlayerApp } from './PlayerApp';

/**
 * `/` — admins default to `/admin` unless they chose the member (player) home.
 */
export function PlayerHome() {
  const { me } = useAuth();

  if (me?.is_admin && !getPreferMemberView()) {
    return <Navigate to="/admin" replace />;
  }

  return <PlayerApp />;
}
