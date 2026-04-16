import { apiBase, apiFetch, parseApiError } from './client';

export interface SessionRecurrenceInfo {
  id: number;
  timezone: string;
  weekday: number;
  hour: number;
  minute: number;
  announce_timezone: string;
  announce_weekday: number;
  announce_hour: number;
  announce_minute: number;
  is_active: boolean;
}

export interface SessionListItem {
  id: number;
  start_time: string;
  location: string;
  fee: number;
  min_players: number;
  max_players: number;
  latitude: number | null;
  longitude: number | null;
  waitlist_mode: string;
  /** Server bump when roster or session fields change; use to invalidate cached UI. */
  content_revision: number;
  recurrence_rule_id?: number | null;
}

export type AttendanceStatus = 'confirmed' | 'waitlisted' | 'cancelled';

export interface SessionDetail extends SessionListItem {
  recurrence?: SessionRecurrenceInfo | null;
  attendees: {
    user_id: number;
    username: string;
    full_name: string | null;
    status: string;
    joined_at: string | null;
    skill: number;
  }[];
  /** Present when the request is authenticated; caller's registration for this session. */
  my_attendance: AttendanceStatus | null;
}

export interface TeamsResponse {
  session_id: number;
  content_revision: number;
  teams: {
    id: string;
    players: {
      id: string;
      name: string;
      skillScore: number;
      isLocked: boolean;
    }[];
  }[];
}

export async function fetchSessions(): Promise<SessionListItem[]> {
  const r = await apiFetch('/sessions/');
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function fetchSessionDetail(id: number): Promise<SessionDetail> {
  const r = await apiFetch(`/sessions/${id}`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function fetchSessionTeams(id: number): Promise<TeamsResponse> {
  const r = await apiFetch(`/sessions/${id}/teams`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function joinSession(id: number): Promise<{
  status: string;
  attendance_id?: number;
}> {
  const r = await apiFetch(`/sessions/${id}/join`, { method: 'POST' });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<{ status: string; attendance_id?: number }>;
}

export async function leaveSession(id: number): Promise<{ status: string }> {
  const r = await apiFetch(`/sessions/${id}/leave`, { method: 'DELETE' });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<{ status: string }>;
}

/** @deprecated use apiBase from client — kept for any legacy imports */
export { apiBase as getApiBase };
