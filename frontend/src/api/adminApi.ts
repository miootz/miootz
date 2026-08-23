import { apiFetch, parseApiError } from './client';

export type WaitlistMode = 'broadcast' | 'auto_promote';

export type TeamAssignmentMode = 'balanced' | 'random';

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
  /** When true (default), email all users with join links for this meetup. */
  send_push_notifications?: boolean;
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
}

/** Recurring schedule + defaults (admin `/admin/game-templates`). */
export interface GameTemplatePayload {
  name: string;
  timezone: string;
  weekday: number;
  hour: number;
  minute: number;
  announce_timezone: string;
  announce_weekday: number;
  announce_hour: number;
  announce_minute: number;
  location: string;
  fee: number;
  min_players: number;
  max_players: number;
  latitude?: number | null;
  longitude?: number | null;
  waitlist_mode: WaitlistMode;
  team_assignment_mode: TeamAssignmentMode;
  is_active: boolean;
  match_duration_minutes?: number;
}

export type GameTemplateRow = GameTemplatePayload & {
  id: number;
  materialized_session_count?: number;
};

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

export interface AdjustTeamsResponse {
  operation: 'expand' | 'contract';
  max_teams: number;
  teams: Array<{
    id: string;
    name: string;
    players: Array<{
      id: string;
      name: string;
      skillScore: number;
      isLocked: boolean;
      profilePic?: string | null;
      primarySpecialty?: string | null;
      secondarySpecialty?: string | null;
      calculatedSkill?: number | null;
    }>;
  }>;
  promoted_user_ids?: number[];
  returned_user_ids?: number[];
  content_revision: number;
}

export async function adminAdjustTeams(
  sessionId: number,
  operation: 'expand' | 'contract',
  numTeams: number = 1
): Promise<AdjustTeamsResponse> {
  const r = await apiFetch(`/sessions/${sessionId}/teams/adjust`, {
    method: 'POST',
    body: JSON.stringify({ operation, num_teams: numTeams }),
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

export async function adminListGameTemplates(): Promise<{
  items: GameTemplateRow[];
}> {
  const r = await apiFetch('/game-templates/');
  return jsonOrThrow(r);
}

export async function adminGetGameTemplate(id: number): Promise<GameTemplateRow> {
  const r = await apiFetch(`/game-templates/${id}`);
  return jsonOrThrow(r);
}

export async function adminCreateGameTemplate(
  body: GameTemplatePayload
): Promise<GameTemplateRow> {
  const r = await apiFetch('/game-templates/', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function adminUpdateGameTemplate(
  id: number,
  body: Partial<GameTemplatePayload>
): Promise<GameTemplateRow> {
  const r = await apiFetch(`/game-templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function adminDeleteGameTemplate(
  id: number
): Promise<{ status: string }> {
  const r = await apiFetch(`/game-templates/${id}`, { method: 'DELETE' });
  return jsonOrThrow(r);
}

export async function adminRunRecurringNow(): Promise<{
  status: string;
  templates_checked: number;
  sessions_created: number;
}> {
  const r = await apiFetch('/sessions/recurring/run-now', { method: 'POST' });
  return jsonOrThrow(r);
}

export async function adminCreateUser(body: {
  first_name: string;
  last_name: string;
}): Promise<AdminUserRow> {
  const r = await apiFetch('/users', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function adminGenerateInvite(userId: number): Promise<{
  invite_link: string;
  expires_at: string;
}> {
  const r = await apiFetch(`/users/${userId}/invite`, {
    method: 'POST',
  });
  return jsonOrThrow(r);
}

export type AdminUserRow = {
  id: number;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  self_assessed_skill: number | null;
  calculated_skill: number | null;
  primary_specialty: string | null;
  secondary_specialty: string | null;
  is_admin: boolean;
  pocket_id_sub: string | null;
  has_pocket_id: boolean;
};

export interface AdminUserUpdate {
  self_assessed_skill?: number | null;
  primary_specialty?: string | null;
  secondary_specialty?: string | null;
  is_admin?: boolean;
  display_name?: string | null;
}

export async function adminListUsers(): Promise<AdminUserRow[]> {
  const r = await apiFetch('/users');
  const data = await jsonOrThrow<{ items: AdminUserRow[] }>(r);
  return data.items;
}

export async function adminUpdateUser(
  userId: number,
  body: AdminUserUpdate
): Promise<{ message: string }> {
  const r = await apiFetch(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function adminDeleteUser(userId: number): Promise<{ message: string }> {
  const r = await apiFetch(`/users/${userId}`, { method: 'DELETE' });
  return jsonOrThrow(r);
}

export type AdminInviteRow = {
  token: string;
  first_name: string;
  last_name: string;
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
