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
  own_goals: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  wins: number;
  losses: number;
  matches: number;
  win_rate: number;
  goal_assists: number;
  goals_per_match: number;
  assists_per_match: number;
  goal_assists_per_match: number;
  penalties_taken: number;
  penalties_scored: number;
  penalty_conversion_rate: number;
}

export interface HighlightEntry {
  user_id: number;
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

export interface DrawMatch {
  team_a: string;
  score_a: number;
  team_b: string;
  score_b: number;
  /** Away side advances to the next match. */
  advancer: string;
}

export interface NightStats {
  kpis: {
    matches: number;
    goals: number;
    players: number;
    draws: number;
  };
  teams: TeamNightRecord[];
  draw_matches: DrawMatch[];
  assists_credited: number;
  open_play_goals: number;
}

export type AttributeSort = "sho" | "pas" | "def";

export interface AttributeRankingRow {
  rank: number | null;
  user: RankingUser;
  sho: number | null;
  pas: number | null;
  def: number | null;
}

export interface AttributeRankingsResponse {
  total: number;
  rows: AttributeRankingRow[];
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

export type RankingSort = keyof Omit<RankingRow, "rank" | "user">;

export async function fetchRankings(
  params: {
    year?: number | "all";
    includeOwnGoals?: boolean;
    sort?: RankingSort;
    order?: "asc" | "desc";
    page?: number;
    perPage?: number;
  },
  signal?: AbortSignal,
): Promise<RankingsResponse> {
  const q = new URLSearchParams();
  if (params.year !== undefined) q.set("year", String(params.year));
  if (params.includeOwnGoals) q.set("include_own_goals", "1");
  if (params.sort) q.set("sort", params.sort);
  if (params.order) q.set("order", params.order);
  q.set("page", String(params.page ?? 1));
  q.set("per_page", String(params.perPage ?? 25));
  const r = await apiFetch(`/rankings?${q.toString()}`, { signal });
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

export async function fetchAttributeRankings(
  params: {
    year: number | "all";
    sort: AttributeSort;
    order: "asc" | "desc";
    page: number;
    perPage: number;
  },
  signal?: AbortSignal,
): Promise<AttributeRankingsResponse> {
  const q = new URLSearchParams({
    year: String(params.year),
    sort: params.sort,
    order: params.order,
    page: String(params.page),
    per_page: String(params.perPage),
  });
  const r = await apiFetch(`/rankings/attributes?${q.toString()}`, { signal });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<AttributeRankingsResponse>;
}
