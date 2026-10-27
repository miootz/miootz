import { apiFetch, parseApiError } from "./client";

export interface MatchTeamInfo {
  name: string;
  users: { id: number; display_name: string; avatar_url: string | null }[];
}

export interface MatchSummary {
  id: number;
  meetup_id: number;
  match_number: number;
  team_a: MatchTeamInfo;
  team_b: MatchTeamInfo;
  score_a: number;
  score_b: number;
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
  body: { team_a_users: number[]; team_b_users: number[] },
): Promise<MatchSummary> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/${matchId}/teams`, {
    method: "PATCH",
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
): Promise<{
  status: string;
  match: MatchSummary;
  winner_team: "a" | "b";
  winner_name: string;
  next_match?: MatchSummary;
  all_matches_complete?: boolean;
}> {
  const body: Record<string, unknown> = {};
  if (winner_team) body.winner_team = winner_team;
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
