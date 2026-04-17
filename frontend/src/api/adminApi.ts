import { apiFetch, parseApiError } from './client';

export type WaitlistMode = 'broadcast' | 'auto_promote';

export type TeamAssignmentMode = 'balanced' | 'random';

export interface RecurrenceConfigBody {
  enabled: boolean;
  timezone: string;
  weekday: number;
  hour: number;
  minute: number;
  announce_timezone: string;
  announce_weekday: number;
  announce_hour: number;
  announce_minute: number;
}

export interface SessionCreateBody {
  start_time: string;
  location: string;
  fee?: number;
  min_players?: number;
  max_players?: number;
  latitude?: number | null;
  longitude?: number | null;
  waitlist_mode?: WaitlistMode;
  team_assignment_mode?: TeamAssignmentMode;
  recurrence?: RecurrenceConfigBody;
  /** When true (default), email all users with join links — same as recurrence announcements. */
  send_invite_emails?: boolean;
}

export interface SessionUpdateBody {
  start_time?: string;
  location?: string;
  fee?: number;
  min_players?: number;
  max_players?: number;
  latitude?: number | null;
  longitude?: number | null;
  waitlist_mode?: WaitlistMode;
  team_assignment_mode?: TeamAssignmentMode;
  recurrence?: RecurrenceConfigBody;
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<T>;
}

export async function adminCreateSession(
  body: SessionCreateBody
): Promise<{ id: number } & Record<string, unknown>> {
  const r = await apiFetch('/sessions/', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function adminUpdateSession(
  id: number,
  body: SessionUpdateBody
): Promise<{ status: string }> {
  const r = await apiFetch(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function adminDeleteSession(id: number): Promise<{ status: string }> {
  const r = await apiFetch(`/sessions/${id}`, { method: 'DELETE' });
  return jsonOrThrow(r);
}

export async function adminReshuffleTeams(
  sessionId: number
): Promise<{ status: string; content_revision?: number }> {
  const r = await apiFetch(`/sessions/${sessionId}/teams/reshuffle`, {
    method: 'POST',
  });
  return jsonOrThrow(r);
}

export async function adminSetUserSelfAssessedSkill(
  userId: number,
  selfAssessedSkill: number
): Promise<{ message: string }> {
  const r = await apiFetch(`/users/${userId}/self-assessed-skill`, {
    method: 'PATCH',
    body: JSON.stringify({ self_assessed_skill: selfAssessedSkill }),
  });
  return jsonOrThrow(r);
}

export async function adminMoveAttendance(
  sessionId: number,
  userId: number,
  newStatus: 'confirmed' | 'waitlisted'
): Promise<{ status: string }> {
  const q = new URLSearchParams({
    user_id: String(userId),
    new_status: newStatus,
  });
  const r = await apiFetch(`/sessions/${sessionId}/admin/move?${q}`, {
    method: 'POST',
  });
  return jsonOrThrow(r);
}

export async function adminRunRecurringNow(): Promise<{
  status: string;
  rules_checked: number;
  sessions_created: number;
}> {
  const r = await apiFetch('/sessions/recurring/run-now', { method: 'POST' });
  return jsonOrThrow(r);
}

export async function adminCreateInvite(email: string): Promise<{
  invite_link: string;
  expires_at: string;
}> {
  const q = new URLSearchParams({ email });
  const r = await apiFetch(`/invites/create?${q}`, { method: 'POST' });
  return jsonOrThrow(r);
}

export type AdminInviteRow = {
  token: string;
  email: string;
  created_at: string;
  expires_at: string;
  used: boolean;
  invite_link: string;
};

export async function adminListInvites(options?: {
  limit?: number;
  offset?: number;
}): Promise<AdminInviteRow[]> {
  const p = new URLSearchParams();
  if (options?.limit != null) p.set('limit', String(options.limit));
  if (options?.offset != null) p.set('offset', String(options.offset));
  const qs = p.toString();
  const r = await apiFetch(`/invites/admin/list${qs ? `?${qs}` : ''}`);
  return jsonOrThrow(r);
}
