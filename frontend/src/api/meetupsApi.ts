import { apiBase, apiFetch, parseApiError } from "./client";

/**
 * Same-origin URL for meetup roster/detail SSE (join, leave, admin moves,
 * team reshuffle).
 *
 * EventSource cannot set Authorization headers, so the access token travels
 * as `?access_token=` — the backend accepts query tokens ONLY on the SSE
 * paths (`/data/events`, `/chat/events`). Trade-off: the token can appear
 * in proxy/server access logs; acceptable on this LAN deployment, revisit if
 * the app becomes internet-facing (then switch to fetch-streaming or
 * short-lived SSE tickets).
 */
export function meetupDataEventsUrl(
  meetupId: number,
  accessToken: string | undefined,
): string {
  const base = `${apiBase()}/meetups/${meetupId}/data/events`;
  return accessToken
    ? `${base}?access_token=${encodeURIComponent(accessToken)}`
    : base;
}

export function meetupChatEventsUrl(
  meetupId: string | number,
  accessToken: string | undefined,
): string {
  const base = `${apiBase()}/meetups/${meetupId}/chat/events`;
  return accessToken
    ? `${base}?access_token=${encodeURIComponent(accessToken)}`
    : base;
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

export interface MeetupListItem {
  id: number;
  start_time: string;
  /** Meetup duration in minutes (null defaults to 120). */
  duration_minutes?: number | null;
  location: string;
  fee: number;
  min_players: number;
  max_players: number;
  latitude: number | null;
  longitude: number | null;
  waitlist_mode: string;
  team_assignment_mode?: string;
  /** Server bump when roster or meetup fields change; use to invalidate cached UI. */
  content_revision: number;
  game_template_id?: number | null;
  game_template?: GameTemplateInfo | null;
  /** Confirmed roster count (list endpoint only; defaults to 0 if omitted). */
  confirmed_count?: number;
}

export interface MeetupListResponse {
  items: MeetupListItem[];
  total: number;
  limit: number | null;
  offset: number;
}

export type AttendanceStatus = "confirmed" | "waitlisted" | "cancelled";

export interface MeetupDetail extends MeetupListItem {
  team_assignment_mode?: string;
  game_template?: GameTemplateInfo | null;
  /** Meetup duration in minutes (null defaults to 120). */
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
  /** Present when the request is authenticated; caller's registration for this meetup. */
  my_attendance: AttendanceStatus | null;
  /** 1-based position in the waitlist when `my_attendance === 'waitlisted'`. */
  my_waitlist_position?: number | null;
}

export interface MeetupHistorySummary {
  match_count: number;
  final: {
    team_a_name: string;
    score_a: number;
    team_b_name: string;
    score_b: number;
  } | null;
  my_rating_avg: number | null;
}

export async function fetchMeetupHistorySummary(
  meetupId: number,
): Promise<MeetupHistorySummary> {
  const r = await apiFetch(`/meetups/${meetupId}/history-summary`);
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
  meetup_id: number;
  inviter_display_name: string;
  guest_display_name: string;
}

export interface TeamsResponse {
  meetup_id: number;
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

export async function fetchMeetups(options?: {
  limit?: number;
  offset?: number;
  /** Server-side location contains filter */
  q?: string;
  status?: "past" | "upcoming" | "all";
  order?: "asc" | "desc";
}): Promise<MeetupListResponse> {
  const p = new URLSearchParams();
  if (options?.limit != null) p.set("limit", String(options.limit));
  if (options?.offset != null) p.set("offset", String(options.offset));
  if (options?.q?.trim()) p.set("q", options.q.trim());
  if (options?.status) p.set("status", options.status);
  if (options?.order) p.set("order", options.order);
  const qs = p.toString();
  const r = await apiFetch(`/meetups/${qs ? `?${qs}` : ""}`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<MeetupListResponse>;
}

export async function fetchMeetupDetail(id: number): Promise<MeetupDetail> {
  const r = await apiFetch(`/meetups/${id}`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function fetchMeetupTeams(id: number): Promise<TeamsResponse> {
  const r = await apiFetch(`/meetups/${id}/teams`);
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

export async function fetchMeetupScores(
  meetupId: number,
): Promise<MatchScoreItem[]> {
  const r = await apiFetch(`/meetups/${meetupId}/scores`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<MatchScoreItem[]>;
}

export interface MatchScoreSubmit {
  meetup_id: number;
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
export async function patchMeetupTeams(
  id: number,
  teams: string[][],
): Promise<TeamsResponse> {
  const r = await apiFetch(`/meetups/${id}/teams`, {
    method: "PATCH",
    body: JSON.stringify({ teams }),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function joinMeetup(id: number): Promise<{
  status: string;
  attendance_id?: number;
}> {
  const r = await apiFetch(`/meetups/${id}/join`, { method: "POST" });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<{ status: string; attendance_id?: number }>;
}

export async function leaveMeetup(id: number): Promise<{ status: string }> {
  const r = await apiFetch(`/meetups/${id}/leave`, { method: "DELETE" });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<{ status: string }>;
}

export async function postMeetupChatTyping(
  meetupId: string | number,
  typing: boolean,
): Promise<void> {
  const r = await apiFetch(`/meetups/${meetupId}/chat/typing`, {
    method: "POST",
    body: JSON.stringify({ typing }),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
}

// ── Plus-one guest reservations ──────────────────────────────────

export async function addPlusOne(
  meetupId: number,
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
  const r = await apiFetch(`/meetups/${meetupId}/plus-one`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function fetchPlusOnes(
  meetupId: number,
): Promise<PlusOneRecord[]> {
  const r = await apiFetch(`/meetups/${meetupId}/plus-one`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function cancelPlusOne(
  meetupId: number,
  plusOneId: number,
): Promise<{ status: string }> {
  const r = await apiFetch(`/meetups/${meetupId}/plus-one/${plusOneId}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function checkPlusOneClaim(
  claimToken: string,
): Promise<PlusOneClaimCheck> {
  const r = await apiFetch(`/meetups/plus-one/${claimToken}`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function claimPlusOne(claimToken: string): Promise<{
  status: string;
  user_id: number;
  display_name: string;
  self_assessed_skill: number;
}> {
  const r = await apiFetch(`/meetups/plus-one/${claimToken}/claim`, {
    method: "POST",
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}
