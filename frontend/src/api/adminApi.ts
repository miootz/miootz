import { apiFetch, parseApiError } from './client';

export type WaitlistMode = 'broadcast' | 'auto_promote';

export type TeamAssignmentMode = 'balanced' | 'random';

export interface MeetupCreateBody {
  start_time: string;
  location: string;
  fee?: number;
  /** Free-text price label (e.g. "8 credits") — shown instead of the numeric fee. */
  fee_text?: string | null;
  min_players?: number;
  max_players?: number;
  latitude?: number | null;
  longitude?: number | null;
  waitlist_mode?: WaitlistMode;
  team_assignment_mode?: TeamAssignmentMode;
  /** When true (default), push-notify all users with join links for this meetup. */
  send_push_notifications?: boolean;
}

export interface MeetupUpdateBody {
  start_time?: string;
  location?: string;
  fee?: number;
  /** Free-text price label (e.g. "8 credits") — shown instead of the numeric fee. */
  fee_text?: string | null;
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
  /** Free-text price label (e.g. "8 credits") — shown instead of the numeric fee. */
  fee_text?: string | null;
  min_players: number;
  max_players: number;
  latitude?: number | null;
  longitude?: number | null;
  waitlist_mode: WaitlistMode;
  team_assignment_mode: TeamAssignmentMode;
  is_active: boolean;
  match_duration_minutes?: number;
  /** When true, a tie is additionally recorded as a draw for statistics. */
  allows_draws?: boolean;
}

export type GameTemplateRow = GameTemplatePayload & {
  id: number;
  materialized_meetup_count?: number;
  /** Next scheduled announce run (UTC ISO), null when template inactive. */
  next_announce_at?: string | null;
  /** Next scheduled kickoff (UTC ISO), null when template inactive. */
  next_occurrence_at?: string | null;
};

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<T>;
}

export async function adminCreateMeetup(
  body: MeetupCreateBody
): Promise<{ id: number } & Record<string, unknown>> {
  const r = await apiFetch('/meetups/', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function adminUpdateMeetup(
  id: number,
  body: MeetupUpdateBody
): Promise<{ status: string }> {
  const r = await apiFetch(`/meetups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function adminDeleteMeetup(id: number): Promise<{ status: string }> {
  const r = await apiFetch(`/meetups/${id}`, { method: 'DELETE' });
  return jsonOrThrow(r);
}

export async function adminReshuffleTeams(
  meetupId: number,
  body?: { teams: string[][]; locked: string[] }
): Promise<{ status: string; content_revision?: number }> {
  const r = await apiFetch(`/meetups/${meetupId}/teams/reshuffle`, {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body) } : {}),
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
  meetupId: number,
  operation: 'expand' | 'contract',
  numTeams: number = 1
): Promise<AdjustTeamsResponse> {
  const r = await apiFetch(`/meetups/${meetupId}/teams/adjust`, {
    method: 'POST',
    body: JSON.stringify({ operation, num_teams: numTeams }),
  });
  return jsonOrThrow(r);
}

export async function adminMoveAttendance(
  meetupId: number,
  userId: number,
  newStatus: 'confirmed' | 'waitlisted'
): Promise<{ status: string }> {
  const q = new URLSearchParams({
    user_id: String(userId),
    new_status: newStatus,
  });
  const r = await apiFetch(`/meetups/${meetupId}/admin/move?${q}`, {
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
  meetups_created: number;
}> {
  const r = await apiFetch('/meetups/recurring/run-now', { method: 'POST' });
  return jsonOrThrow(r);
}

export async function adminExportData(): Promise<Blob> {
  const response = await apiFetch('/admin/export');
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.blob();
}

export async function adminCreateUser(body: {
  first_name: string;
  last_name: string;
  calculated_skill: number;
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
  calculated_skill: number | null;
  seed_skill: number | null;
  pac: number | null;
  dri: number | null;
  sho_override?: number | null;
  pas_override?: number | null;
  def_override?: number | null;
  primary_specialty: string | null;
  secondary_specialty: string | null;
  is_admin: boolean;
  pocket_id_sub: string | null;
  has_pocket_id: boolean;
};

export interface AdminUserUpdate {
  seed_skill?: number | null;
  pac?: number | null;
  dri?: number | null;
  sho_override?: number | null;
  pas_override?: number | null;
  def_override?: number | null;
  primary_specialty?: string | null;
  secondary_specialty?: string | null;
  is_admin?: boolean;
  display_name?: string | null;
}

export async function adminListUsers(options?: {
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: AdminUserRow[]; total: number }> {
  const p = new URLSearchParams();
  if (options?.q) p.set('q', options.q);
  if (options?.limit != null) p.set('limit', String(options.limit));
  if (options?.offset != null) p.set('offset', String(options.offset));
  const qs = p.toString();
  const r = await apiFetch(`/users${qs ? `?${qs}` : ''}`);
  return jsonOrThrow(r);
}

export interface PlayerHistoryRow {
  meetup_id: number;
  start_time: string;
  location: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled';
  previous_status: string | null;
  joined_at: string;
  score_team: number | null;
  score_individual: number | null;
  rating_avg: number | null;
}

export interface PlayerHistory {
  user: AdminUserRow;
  stats: {
    games_played: number;
    season_games: number;
    average_rating: number;
    total_ratings: number;
    skill_level: number;
  };
  history: { items: PlayerHistoryRow[]; total: number };
}

export async function adminGetPlayerHistory(
  userId: number,
  options?: { limit?: number; offset?: number }
): Promise<PlayerHistory> {
  const p = new URLSearchParams();
  if (options?.limit != null) p.set('limit', String(options.limit));
  if (options?.offset != null) p.set('offset', String(options.offset));
  const qs = p.toString();
  const r = await apiFetch(`/users/${userId}/history${qs ? `?${qs}` : ''}`);
  return jsonOrThrow(r);
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
