import { apiFetch, parseApiError } from './client';

export type WaitlistMode = 'broadcast' | 'auto_promote';

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
  recurrence?: RecurrenceConfigBody;
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
