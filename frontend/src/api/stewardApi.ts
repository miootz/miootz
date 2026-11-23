/**
 * Steward / lease / goal API client (plan: live-collaborative-scoring §4).
 *
 * - steward-state: fetched once on mount to decide whether controls render.
 * - lease: one-writer window for goal entry (45 s, renewable).
 * - goals: CRUD for the live goal log; POST is idempotent via intent_id.
 */
import { apiFetch, parseApiError } from "./client";

export interface StewardState {
  can_control: boolean;
  /** 'ok' when can_control; explains why not otherwise. */
  reason: "ok" | "not_attending" | "outside_window" | string;
  /** Current lease (holder may be me) — null when nobody holds it. */
  lease: { holder_name: string; expires_in: number } | null;
}

export interface LeaseAcquired {
  lease_token: string;
  expires_in: number;
}

export interface LeaseBusy {
  holder_name: string;
  expires_in: number;
}

export type AcquireResult =
  | { ok: true; lease: LeaseAcquired }
  | { ok: false; busy: LeaseBusy };

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

export async function fetchStewardState(
  meetupId: number,
): Promise<StewardState> {
  const r = await apiFetch(`/meetups/${meetupId}/steward-state`);
  if (!r.ok) throw new Error(await parseApiError(r));
  const j = (await r.json()) as Partial<StewardState>;
  return {
    can_control: !!j.can_control,
    reason: str(j.reason, "unknown"),
    lease:
      j.lease && typeof j.lease === "object"
        ? {
            holder_name: str(j.lease.holder_name, "Someone"),
            expires_in: num(j.lease.expires_in),
          }
        : null,
  };
}

/**
 * Acquire the one-writer lease. `matchId` scopes it to a specific match
 * (parallel 2-pitch play); omit for the current match.
 * `ok:false` is NOT an error — it means the lease is held by someone else
 * (named, never silent).
 */
export async function acquireLease(
  meetupId: number,
  matchId?: number,
): Promise<AcquireResult> {
  const r = await apiFetch(
    `/meetups/${meetupId}/matches/lease/acquire${
      matchId != null ? `?match_id=${matchId}` : ""
    }`,
    { method: "POST" },
  );
  if (r.status === 409) {
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: false,
      busy: {
        holder_name: str(j.holder_name, "Someone"),
        expires_in: num(j.expires_in),
      },
    };
  }
  if (!r.ok) throw new Error(await parseApiError(r));
  const j = (await r.json()) as Record<string, unknown>;
  return {
    ok: true,
    lease: {
      lease_token: str(j.lease_token, ""),
      expires_in: num(j.expires_in, 45),
    },
  };
}

export async function renewLease(
  meetupId: number,
  leaseToken: string,
  matchId?: number,
): Promise<AcquireResult> {
  const r = await apiFetch(
    `/meetups/${meetupId}/matches/lease/renew${
      matchId != null ? `?match_id=${matchId}` : ""
    }`,
    {
      method: "POST",
      body: JSON.stringify({ lease_token: leaseToken }),
    },
  );
  if (r.status === 409) {
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: false,
      busy: {
        holder_name: str(j.holder_name, "Someone"),
        expires_in: num(j.expires_in),
      },
    };
  }
  if (!r.ok) throw new Error(await parseApiError(r));
  const j = (await r.json()) as Record<string, unknown>;
  return {
    ok: true,
    lease: {
      lease_token: str(j.lease_token, leaseToken),
      expires_in: num(j.expires_in, 45),
    },
  };
}

export async function releaseLease(
  meetupId: number,
  leaseToken: string,
  matchId?: number,
): Promise<void> {
  try {
    await apiFetch(
      `/meetups/${meetupId}/matches/lease/release${
        matchId != null ? `?match_id=${matchId}` : ""
      }`,
      {
        method: "POST",
        body: JSON.stringify({ lease_token: leaseToken }),
      },
    );
  } catch {
    // Best-effort release — the lease expires on its own otherwise.
  }
}

// ── Goals ─────────────────────────────────────────────────────────

export interface GoalPerson {
  id: number;
  display_name: string;
  /** Proxied Pocket ID picture (see Avatar component); may be null. */
  avatar_url?: string | null;
}

export interface GoalRow {
  id: number;
  team: "a" | "b";
  clock_minute: number;
  scorer: GoalPerson;
  assist: GoalPerson | null;
  /** Keeper who was in goal for the conceding team when this went in. */
  goalkeeper: GoalPerson | null;
  recorded_by: GoalPerson;
  /** 1 when this goal crossed the line after the final whistle. */
  after_whistle?: boolean;
  /** Own goal: the scorer is on the conceding team. */
  is_own_goal?: boolean;
}

function normalizePerson(v: unknown): GoalPerson {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      id: num(o.id ?? o.user_id, 0),
      display_name: str(
        o.display_name ?? o.full_name ?? o.username,
        "Unknown",
      ),
      avatar_url:
        typeof o.avatar_url === "string" && o.avatar_url ? o.avatar_url : null,
    };
  }
  return { id: 0, display_name: str(v, "Unknown") };
}

function normalizeGoal(v: unknown): GoalRow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = num(o.id, NaN);
  if (isNaN(id)) return null;
  const team = o.team === "b" ? "b" : "a";
  return {
    id,
    team,
    clock_minute: num(o.clock_minute, 0),
    scorer: normalizePerson(o.scorer),
    assist: o.assist ? normalizePerson(o.assist) : null,
    goalkeeper: o.goalkeeper ? normalizePerson(o.goalkeeper) : null,
    recorded_by: normalizePerson(o.recorded_by),
    after_whistle: !!o.after_whistle,
    is_own_goal: !!o.is_own_goal,
  };
}

/** Authenticated GET — returns the full goal list for a match (ordered). */
export async function fetchGoals(
  meetupId: number,
  matchId: number,
): Promise<GoalRow[]> {
  return (await fetchGoalLog(meetupId, matchId, false)).goals;
}

export interface HistoricalGoalLog {
  goals: GoalRow[];
  rosters: Record<"a" | "b", GoalPerson[]>;
}

export async function fetchHistoricalGoals(
  meetupId: number,
  matchId: number,
): Promise<HistoricalGoalLog> {
  return fetchGoalLog(meetupId, matchId, true);
}

async function fetchGoalLog(
  meetupId: number,
  matchId: number,
  history: boolean,
): Promise<HistoricalGoalLog> {
  const query = history ? "?include_history_rosters=true" : "";
  const r = await apiFetch(`/meetups/${meetupId}/matches/${matchId}/goals${query}`);
  if (!r.ok) throw new Error(await parseApiError(r));
  const j = (await r.json()) as { goals?: unknown[]; rosters?: HistoricalGoalLog["rosters"] } | unknown[];
  const arr = Array.isArray(j) ? j : Array.isArray(j?.goals) ? j.goals : [];
  return {
    goals: arr
      .map(normalizeGoal)
      .filter((g): g is GoalRow => g != null)
      .sort((a, b) => a.clock_minute - b.clock_minute || a.id - b.id),
    rosters: (!Array.isArray(j) && j.rosters) || { a: [], b: [] },
  };
}

export interface GoalCreateBody {
  team: "a" | "b";
  scorer_id: number;
  assist_id?: number | null;
  /** Must be on the conceding (opposing) team; omit when unknown. */
  goalkeeper_id?: number | null;
  intent_id: string;
  force?: boolean;
  /** Own goal: the scorer is on the conceding team. */
  is_own_goal?: boolean;
}

export type GoalUpdateBody = Omit<GoalCreateBody, "intent_id" | "force"> & {
  clock_minute: number;
};

export interface HistoricalGoalResult {
  goal: GoalRow;
  score_a: number;
  score_b: number;
  was_draw: boolean;
}

export async function saveHistoricalGoal(
  meetupId: number,
  matchId: number,
  body: Omit<GoalCreateBody, "force"> & { goal_id?: number; add_to_score?: boolean },
): Promise<HistoricalGoalResult> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/${matchId}/goal-attribution`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  const { goal, score_a, score_b, was_draw } = await r.json();
  const row = normalizeGoal(goal);
  if (!row) throw new Error("Goal details could not be loaded.");
  return { goal: row, score_a, score_b, was_draw };
}

/**
 * Submit one goal (idempotent via intent_id). The server recomputes the
 * score, releases the lease and broadcasts `goal_added`.
 */
export async function createGoal(
  meetupId: number,
  matchId: number,
  body: GoalCreateBody,
): Promise<{ goal: GoalRow | null }> {
  const r = await apiFetch(`/meetups/${meetupId}/matches/${matchId}/goals`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { goal: normalizeGoal(j.goal ?? j) };
}

/**
 * Edit a logged goal (same team/own-goal/keeper rules as create). The server
 * recomputes the score, releases the lease and broadcasts `goal_updated`.
 */
export async function updateGoal(
  meetupId: number,
  matchId: number,
  goalId: number,
  body: GoalUpdateBody,
): Promise<{ goal: GoalRow | null }> {
  const r = await apiFetch(
    `/meetups/${meetupId}/matches/${matchId}/goals/${goalId}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(await parseApiError(r));
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { goal: normalizeGoal(j.goal ?? j) };
}

export async function deleteGoal(
  meetupId: number,
  matchId: number,
  goalId: number,
): Promise<void> {
  const r = await apiFetch(
    `/meetups/${meetupId}/matches/${matchId}/goals/${goalId}`,
    { method: "DELETE" },
  );
  if (!r.ok) throw new Error(await parseApiError(r));
}
