import { apiBase, apiFetch, parseApiError } from "./client";

/** Same-origin URL for session roster/detail SSE (join, leave, admin moves, team reshuffle). */
export function sessionDataEventsUrl(sessionId: number): string {
  return `${apiBase()}/sessions/${sessionId}/data/events`;
}

export function sessionChatEventsUrl(sessionId: string | number): string {
  return `${apiBase()}/sessions/${sessionId}/chat/events`;
}

export interface GameTemplateInfo {
  id: number;
  name: string;
  timezone: string;
  weekday: number;
  hour: number;
  minute: number;
  announce_timezone: string;
  announce_weekday: number;
  announce_hour: number;
  announce_minute: number;
  is_active: boolean;
  team_assignment_mode?: string;
  /** Next scheduled announce run (UTC ISO), null when template inactive/unscheduled. */
  next_announce_at?: string | null;
}

/** @deprecated use GameTemplateInfo */
export type SessionRecurrenceInfo = GameTemplateInfo;

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
  team_assignment_mode?: string;
  /** Server bump when roster or session fields change; use to invalidate cached UI. */
  content_revision: number;
  game_template_id?: number | null;
  game_template?: GameTemplateInfo | null;
  /** Confirmed roster count (list endpoint only; defaults to 0 if omitted). */
  confirmed_count?: number;
}

export interface SessionListResponse {
  items: SessionListItem[];
  total: number;
  limit: number | null;
  offset: number;
}

export type AttendanceStatus = "confirmed" | "waitlisted" | "cancelled";

export interface SessionDetail extends SessionListItem {
  team_assignment_mode?: string;
  game_template?: GameTemplateInfo | null;
  /** Session duration in minutes (null defaults to 120). */
  duration_minutes?: number | null;
  /** Upper bound on team count. Null = algorithmic. */
  max_teams?: number | null;
  attendees: {
    user_id: number;
    display_name: string;
    avatar_url: string | null;
    status: string;
    joined_at: string | null;
    skill: number;
    self_assessed_skill?: number | null;
    calculated_skill?: number | null;
    /** True when this attendee is a plus-one guest reservation. */
    is_plus_one?: boolean;
    primary_specialty?: "ATT" | "MID" | "DEF" | "GK" | null;
    secondary_specialty?: "ATT" | "MID" | "DEF" | "GK" | null;
  }[];
  /** Present when the request is authenticated; caller's registration for this session. */
  my_attendance: AttendanceStatus | null;
  /** 1-based position in the waitlist when `my_attendance === 'waitlisted'`. */
  my_waitlist_position?: number | null;
}

export interface SessionHistorySummary {
  match_count: number;
  final: {
    team_a_name: string;
    score_a: number;
    team_b_name: string;
    score_b: number;
  } | null;
  my_rating_avg: number | null;
}

export async function fetchSessionHistorySummary(
  sessionId: number,
): Promise<SessionHistorySummary> {
  const r = await apiFetch(`/sessions/${sessionId}/history-summary`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export interface PlusOneCreate {
  first_name: string;
  last_name: string;
  self_assessed_skill: number;
}

export interface PlusOneRecord {
  id: number;
  guest_user_id: number;
  first_name: string;
  last_name: string;
  self_assessed_skill: number;
  inviter_id: number;
  inviter_username: string;
  claim_token: string;
  status: string;
  created_at: string;
}

export interface PlusOneClaimCheck {
  id: number;
  status: string;
  first_name: string;
  last_name: string;
  self_assessed_skill: number;
  session_id: number;
  inviter_username: string;
  guest_username: string;
}

export interface TeamsResponse {
  session_id: number;
  content_revision: number;
  teams: {
    id: string;
    name: string;
    players: {
      id: string;
      name: string;
      skillScore: number;
      isLocked: boolean;
      profilePic?: string | null;
      primarySpecialty?: "ATT" | "MID" | "DEF" | "GK" | null;
      secondarySpecialty?: "ATT" | "MID" | "DEF" | "GK" | null;
      calculatedSkill?: number | null;
    }[];
  }[];
}

export async function fetchSessions(options?: {
  limit?: number;
  offset?: number;
  /** Server-side location contains filter */
  q?: string;
  status?: "past" | "upcoming" | "all";
  order?: "asc" | "desc";
}): Promise<SessionListResponse> {
  const p = new URLSearchParams();
  if (options?.limit != null) p.set("limit", String(options.limit));
  if (options?.offset != null) p.set("offset", String(options.offset));
  if (options?.q?.trim()) p.set("q", options.q.trim());
  if (options?.status) p.set("status", options.status);
  if (options?.order) p.set("order", options.order);
  const qs = p.toString();
  const r = await apiFetch(`/sessions/${qs ? `?${qs}` : ""}`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<SessionListResponse>;
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

// ── Match scores ──────────────────────────────────────────────────

export interface MatchScoreItem {
  id: number;
  player_id: number;
  username: string;
  full_name: string | null;
  score: number;
  type: string;
}

export async function fetchSessionScores(
  sessionId: number,
): Promise<MatchScoreItem[]> {
  const r = await apiFetch(`/sessions/${sessionId}/scores`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<MatchScoreItem[]>;
}

export interface MatchScoreSubmit {
  session_id: number;
  player_id: number;
  score: number;
  type: "team" | "individual";
}

export async function submitMatchScore(
  input: MatchScoreSubmit,
): Promise<{ status: string }> {
  const r = await apiFetch("/users/report-score", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<{ status: string }>;
}

/** Persist admin team lineups (confirmed roster only). */
export async function patchSessionTeams(
  id: number,
  teams: string[][],
): Promise<TeamsResponse> {
  const r = await apiFetch(`/sessions/${id}/teams`, {
    method: "PATCH",
    body: JSON.stringify({ teams }),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function joinSession(id: number): Promise<{
  status: string;
  attendance_id?: number;
}> {
  const r = await apiFetch(`/sessions/${id}/join`, { method: "POST" });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<{ status: string; attendance_id?: number }>;
}

export async function leaveSession(id: number): Promise<{ status: string }> {
  const r = await apiFetch(`/sessions/${id}/leave`, { method: "DELETE" });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<{ status: string }>;
}

export async function postSessionChatTyping(
  sessionId: string | number,
  typing: boolean,
): Promise<void> {
  const r = await apiFetch(`/sessions/${sessionId}/chat/typing`, {
    method: "POST",
    body: JSON.stringify({ typing }),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
}

/** @deprecated use apiBase from client — kept for any legacy imports */
export { apiBase as getApiBase };

// ── Plus-one guest reservations ──────────────────────────────────

export async function addPlusOne(
  sessionId: number,
  body: PlusOneCreate,
): Promise<{
  id: number;
  guest_user_id: number;
  first_name: string;
  last_name: string;
  self_assessed_skill: number;
  claim_token: string;
  claim_url: string;
  attendance_status: string;
}> {
  const r = await apiFetch(`/sessions/${sessionId}/plus-one`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function fetchPlusOnes(
  sessionId: number,
): Promise<PlusOneRecord[]> {
  const r = await apiFetch(`/sessions/${sessionId}/plus-one`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function cancelPlusOne(
  sessionId: number,
  plusOneId: number,
): Promise<{ status: string }> {
  const r = await apiFetch(`/sessions/${sessionId}/plus-one/${plusOneId}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function checkPlusOneClaim(
  claimToken: string,
): Promise<PlusOneClaimCheck> {
  const r = await apiFetch(`/sessions/plus-one/${claimToken}`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function claimPlusOne(
  claimToken: string,
  body: { username: string },
): Promise<{
  status: string;
  user_id: number;
  username: string;
  full_name: string;
  self_assessed_skill: number;
}> {
  const r = await apiFetch(`/sessions/plus-one/${claimToken}/claim`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}
