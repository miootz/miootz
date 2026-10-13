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
  sessionId: number,
): Promise<StewardState> {
  const r = await apiFetch(`/sessions/${sessionId}/steward-state`);
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
 * Acquire the goal-entry lease. `ok:false` is NOT an error — it means the
 * lease is held by someone else (named, never silent).
 */
export async function acquireLease(
  sessionId: number,
): Promise<AcquireResult> {
  const r = await apiFetch(`/sessions/${sessionId}/matches/lease/acquire`, {
    method: "POST",
  });
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
  sessionId: number,
  leaseToken: string,
): Promise<AcquireResult> {
  const r = await apiFetch(`/sessions/${sessionId}/matches/lease/renew`, {
    method: "POST",
    body: JSON.stringify({ lease_token: leaseToken }),
  });
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
  sessionId: number,
  leaseToken: string,
): Promise<void> {
  try {
    await apiFetch(`/sessions/${sessionId}/matches/lease/release`, {
      method: "POST",
      body: JSON.stringify({ lease_token: leaseToken }),
    });
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
  };
}

/** Public GET — returns the full goal list for a match (already ordered). */
export async function fetchGoals(
  sessionId: number,
  matchId: number,
): Promise<GoalRow[]> {
  const r = await apiFetch(
    `/sessions/${sessionId}/matches/${matchId}/goals`,
    { skipAuth: true },
  );
  if (!r.ok) throw new Error(await parseApiError(r));
  const j = (await r.json()) as { goals?: unknown[] } | unknown[];
  const arr = Array.isArray(j) ? j : Array.isArray(j?.goals) ? j.goals : [];
  return arr
    .map(normalizeGoal)
    .filter((g): g is GoalRow => g != null)
    .sort((a, b) => a.clock_minute - b.clock_minute || a.id - b.id);
}

export interface GoalCreateBody {
  team: "a" | "b";
  scorer_id: number;
  assist_id?: number | null;
  /** Must be on the conceding (opposing) team; omit when unknown. */
  goalkeeper_id?: number | null;
  intent_id: string;
  force?: boolean;
}

/**
 * Submit one goal (idempotent via intent_id). The server recomputes the
 * score, releases the lease and broadcasts `goal_added`.
 */
export async function createGoal(
  sessionId: number,
  matchId: number,
  body: GoalCreateBody,
): Promise<{ goal: GoalRow | null }> {
  const r = await apiFetch(`/sessions/${sessionId}/matches/${matchId}/goals`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { goal: normalizeGoal(j.goal ?? j) };
}

export async function deleteGoal(
  sessionId: number,
  matchId: number,
  goalId: number,
): Promise<void> {
  const r = await apiFetch(
    `/sessions/${sessionId}/matches/${matchId}/goals/${goalId}`,
    { method: "DELETE" },
  );
  if (!r.ok) throw new Error(await parseApiError(r));
}
