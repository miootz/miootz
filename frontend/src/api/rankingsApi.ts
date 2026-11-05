import { apiFetch, parseApiError } from "./client";

export interface RankingUser {
  id: number;
  display_name: string;
  avatar_url: string | null;
}

export interface RankingRow {
  rank: number;
  user: RankingUser;
  attendances: number;
  goals: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  wins: number;
  matches: number;
  win_rate: number;
  goal_assists: number;
}

export interface HighlightEntry {
  name: string;
  value: string | number;
}

export interface TeamRosterUser {
  id: number;
  display_name: string;
}

export interface TeamNightRecord {
  name: string;
  wins: number;
  matches: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  clean_sheets: number;
  roster: TeamRosterUser[];
}

export interface NightStats {
  kpis: {
    matches: number;
    goals: number;
    players: number;
    one_goal_wins: number;
    draws: number;
  };
  teams: TeamNightRecord[];
}

export interface RankingsResponse {
  /** Selected season; null = all time (or the per-meetup scope). */
  year: number | null;
  /** Calendar years that have data (null for the per-meetup scope). */
  available_years: number[] | null;
  page: number;
  per_page: number;
  total: number;
  /** Per-meetup night stats (meetup-scoped endpoint only). */
  night: NightStats | null;
  /** Top-3 per category over the full scope (season/all-time views). */
  highlights: Record<string, HighlightEntry[]> | null;
  rows: RankingRow[];
}

export type RankingSort =
  | "attendances"
  | "goals"
  | "assists"
  | "clean_sheets"
  | "goals_conceded"
  | "wins"
  | "matches"
  | "win_rate"
  | "goal_assists";

export async function fetchRankings(params: {
  year?: number | "all";
  includeOwnGoals?: boolean;
  sort?: RankingSort;
  order?: "asc" | "desc";
  page?: number;
  perPage?: number;
}): Promise<RankingsResponse> {
  const q = new URLSearchParams();
  if (params.year !== undefined) q.set("year", String(params.year));
  if (params.includeOwnGoals) q.set("include_own_goals", "1");
  if (params.sort) q.set("sort", params.sort);
  if (params.order) q.set("order", params.order);
  q.set("page", String(params.page ?? 1));
  q.set("per_page", String(params.perPage ?? 25));
  const r = await apiFetch(`/rankings?${q.toString()}`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return (await r.json()) as RankingsResponse;
}

export async function fetchMeetupRankings(
  meetupId: number,
): Promise<RankingsResponse> {
  const r = await apiFetch(`/meetups/${meetupId}/rankings`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return (await r.json()) as RankingsResponse;
}
