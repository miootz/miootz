import { apiFetch, parseApiError } from "./client";

export interface MatchTeamInfo {
  name: string;
  users: { id: number; display_name: string; avatar_url: string | null; pac?: number | null; dri?: number | null }[];
}

export interface MatchSummary {
  id: number;
  meetup_id: number;
  match_number: number;
  team_a: MatchTeamInfo;
  team_b: MatchTeamInfo;
  score_a: number;
  score_b: number;
  /** True when the match ended level and the template records draws. */
  was_draw?: boolean;
  /** 'a' | 'b' when a penalty shootout resolved a tied first match. */
  penalty_winner?: "a" | "b" | null;
  penalty_skipped?: boolean;
  status: "pending" | "active" | "time_up" | "completed";
  timer_total_seconds: number;
  timer_seconds_remaining: number;
  timer_paused: boolean;
  /** Server-authoritative end time (UTC ISO) while the timer runs; null when paused/finished. */
  timer_ends_at?: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface MeetupMatchesResponse {
  matches: MatchSummary[];
  match_duration_minutes: number;
}

export interface MatchCreateBody {
  team_a_name: string;
  team_b_name: string;
  score_a: number;
  score_b: number;
  /** Optional starting lineups; when omitted the match starts with an empty lineup. */
  team_a_users?: number[];
  team_b_users?: number[];
}

export async function createMatch(
  meetupId: number,
  body: MatchCreateBody,
): Promise<{ status: string; match: MatchSummary }> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/create`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function fetchMeetupMatches(
  meetupId: number,
): Promise<MeetupMatchesResponse> {
  const r = await apiFetch(`/meetups/${meetupId}/matches`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function fetchMatch(
  meetupId: number,
  matchId: number,
): Promise<MatchSummary> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/${matchId}`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function startMatches(
  meetupId: number,
  body?: { team_a_idx?: number; team_b_idx?: number },
): Promise<{ status: string; match: MatchSummary }> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/start`, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function createNewPendingMatch(
  meetupId: number,
  body?: { team_a_idx?: number; team_b_idx?: number },
): Promise<{ status: string; match: MatchSummary }> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/new`, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function swapMatchTeams(
  meetupId: number,
  matchId: number,
  body: { team_a_users: number[]; team_b_users: number[]; add_sideline_player?: boolean },
): Promise<MatchSummary> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/${matchId}/teams`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export interface MatchSubstitution {
  id: number;
  recorded_by: string | null;
  created_at: string | null;
  /** Match-clock seconds for a mid-match (timer-paused) swap; null pre-start. */
  clock_secs?: number | null;
  old_team_a_users: number[];
  old_team_b_users: number[];
  new_team_a_users: number[];
  new_team_b_users: number[];
}

export async function fetchMatchSubstitutions(
  meetupId: number,
  matchId: number,
): Promise<{ substitutions: MatchSubstitution[] }> {
  const r = await apiFetch(
    `/meetups/${meetupId}/matches/${matchId}/substitutions`,
  );
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function recordHistoricalSubstitution(
  meetupId: number,
  matchId: number,
  body: {
    team: "a" | "b";
    player_off: number | null;
    player_on: number | null;
    elapsed_seconds: number | null;
    swap_teams?: boolean;
  },
): Promise<{ match: MatchSummary; substitutions: MatchSubstitution[] }> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/${matchId}/substitutions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function startTimer(
  meetupId: number,
  matchId: number,
): Promise<{ status: string; seconds_remaining: number }> {
  const r = await apiFetch(
    `/meetups/${meetupId}/matches/${matchId}/timer/start`,
    { method: "POST" },
  );
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function pauseTimer(
  meetupId: number,
  matchId: number,
): Promise<{ status: string; seconds_remaining: number }> {
  const r = await apiFetch(
    `/meetups/${meetupId}/matches/${matchId}/timer/pause`,
    { method: "POST" },
  );
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function resumeTimer(
  meetupId: number,
  matchId: number,
): Promise<{ status: string; seconds_remaining: number }> {
  const r = await apiFetch(
    `/meetups/${meetupId}/matches/${matchId}/timer/resume`,
    { method: "POST" },
  );
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function resetMatch(
  meetupId: number,
  matchId: number,
): Promise<MatchSummary> {
  const r = await apiFetch(
    `/meetups/${meetupId}/matches/${matchId}/timer/reset`,
    { method: "POST" },
  );
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function incrementScore(
  meetupId: number,
  matchId: number,
  team: "a" | "b",
  delta = 1,
): Promise<{ score_a: number; score_b: number }> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/${matchId}/score`, {
    method: "POST",
    body: JSON.stringify({ team, delta }),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function setScores(
  meetupId: number,
  matchId: number,
  score_a: number,
  score_b: number,
): Promise<{ score_a: number; score_b: number }> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/${matchId}/score`, {
    method: "PATCH",
    body: JSON.stringify({ score_a, score_b }),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function endMatch(
  meetupId: number,
  matchId: number,
  winner_team?: "a" | "b",
  /** When true, the next match is not auto-queued — the referee overrides the team picking. */
  skip_next_match?: boolean,
): Promise<{
  status: string;
  match: MatchSummary;
  winner_team: "a" | "b";
  winner_name: string;
  /** True when a tied first match goes to a penalty shootout. */
  penalty_due?: boolean;
  next_match?: MatchSummary;
  all_matches_complete?: boolean;
}> {
  const body: Record<string, unknown> = {};
  if (winner_team) body.winner_team = winner_team;
  if (skip_next_match) body.skip_next_match = true;
  const r = await apiFetch(`/meetups/${meetupId}/matches/${matchId}/end`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export async function deleteMatch(
  meetupId: number,
  matchId: number,
): Promise<void> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/${matchId}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error(await parseApiError(r));
}

// ── Penalty shootout (tied first match) ───────────────────────────

export interface PenaltyShot {
  id: number;
  team: "a" | "b";
  scored: boolean;
  scorer: { id: number; display_name: string; avatar_url?: string | null };
}

export interface PenaltyState {
  available: boolean;
  winner: "a" | "b" | null;
  shots: PenaltyShot[];
  counts: { a: number; b: number };
  /** A side has an uncatchable lead — finish is allowed. */
  decided: boolean;
}

async function penaltyFetch<T>(
  meetupId: number,
  matchId: number,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  const r = await apiFetch(
    `/meetups/${meetupId}/matches/${matchId}/penalty${path}`,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json();
}

export function fetchPenalty(
  meetupId: number,
  matchId: number,
): Promise<PenaltyState> {
  return penaltyFetch(meetupId, matchId, "", "GET");
}

export function addPenaltyShot(
  meetupId: number,
  matchId: number,
  team: "a" | "b",
  scored: boolean,
  scorerId: number,
): Promise<PenaltyState> {
  return penaltyFetch(meetupId, matchId, "/shots", "POST", {
    team,
    scored,
    scorer_id: scorerId,
  });
}

export function undoPenaltyShot(
  meetupId: number,
  matchId: number,
): Promise<PenaltyState> {
  return penaltyFetch(meetupId, matchId, "/undo", "POST");
}

export function finishPenaltyShootout(
  meetupId: number,
  matchId: number,
): Promise<{
  winner: "a" | "b";
  match: MatchSummary;
  next_match?: MatchSummary;
}> {
  return penaltyFetch(meetupId, matchId, "/finish", "POST");
}

export function skipPenaltyShootout(meetupId: number, matchId: number): Promise<PenaltyState> {
  return penaltyFetch(meetupId, matchId, "/skip", "POST");
}
