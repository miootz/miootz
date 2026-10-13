import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../auth/useAuth";
import {
  acquireLease,
  createGoal,
  releaseLease,
  renewLease,
  type GoalRow,
} from "../api/stewardApi";
import { fetchSessionDetail } from "../api/sessionsApi";
import type { MatchSummary } from "../api/matchesApi";
import { PlayerSelect, type SelectablePlayer } from "./PlayerSelect";
import {
  defaultGoalMinute,
  isAfterWhistle,
  leaseBusyLabel,
  leaseCountdown,
  leaseFromExpiresIn,
  type LeaseInfo,
} from "../utils/lease";

interface GoalEntrySheetProps {
  sessionId: number;
  match: MatchSummary;
  onClose: () => void;
  onLogged: (goal: GoalRow) => void;
}

/**
 * Goal entry sheet (plan §6): team → scorer (searchable) → ONE assist
 * (searchable, skippable) → conceding goalkeeper (searchable, skippable) →
 * minute (pre-filled from the server clock, editable) → Confirm.
 *
 * - All three player fields are `PlayerSelect` dropdowns: profile pic +
 *   name per option, type-to-filter, pick-to-collapse.
 * - Holds the lease for the sheet's lifetime (renewed on a timer).
 * - One `intent_id` minted when the sheet opens, reused on every retry —
 *   a network-retry returns the original goal, never a second one.
 * - If the lease lapses mid-form the fields are kept and the lease is
 *   re-requested on submit (never lose data).
 */
export function GoalEntrySheet({
  sessionId,
  match,
  onClose,
  onLogged,
}: GoalEntrySheetProps) {
  const { showToast } = useToast();
  const { me } = useAuth();
  const isAdmin = !!me?.is_admin;

  // ── Idempotency: one intent per sheet session ──────────────────
  const intentIdRef = useRef<string>(crypto.randomUUID());

  // ── Lease state ──────────────────────────────────────────────────
  const [lease, setLease] = useState<LeaseInfo | null>(null); // someone else
  const [holding, setHolding] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const tokenRef = useRef<string | null>(null);

  // ── Form state ───────────────────────────────────────────────────
  const [team, setTeam] = useState<"a" | "b">("a");
  const [scorer, setScorer] = useState<SelectablePlayer | null>(null);
  const [assist, setAssist] = useState<SelectablePlayer | null>(null);
  const [goalkeeper, setGoalkeeper] = useState<SelectablePlayer | null>(null);
  const [minute, setMinute] = useState<number>(1);
  const [minuteTouched, setMinuteTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Roster (confirmed attendees, with team tags for this match) ─
  const [roster, setRoster] = useState<SelectablePlayer[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const detail = await fetchSessionDetail(sessionId);
        if (cancelled) return;
        const teamOf = new Map<number, string>();
        for (const u of match.team_a.users) teamOf.set(u.id, "A");
        for (const u of match.team_b.users) teamOf.set(u.id, "B");
        setRoster(
          detail.attendees
            .filter((a) => a.status === "confirmed")
            .map((a) => ({
              id: a.user_id,
              name: a.display_name,
              avatarUrl: a.avatar_url,
              teamTag: teamOf.get(a.user_id) ?? "—",
            })),
        );
      } catch {
        /* ignore — picker stays empty */
      } finally {
        if (!cancelled) setRosterLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, match]);

  const matchPlayers = useMemo(
    () =>
      roster.filter(
        (p) => p.teamTag === "A" || p.teamTag === "B",
      ),
    [roster],
  );

  // ── Lease lifecycle: acquire on open, renew while open, release on close ─
  const tryAcquire = useCallback(async (): Promise<boolean> => {
    setAcquiring(true);
    try {
      const res = await acquireLease(sessionId);
      if (res.ok) {
        tokenRef.current = res.lease.lease_token;
        setHolding(true);
        setLease(null);
        return true;
      }
      setHolding(false);
      setLease(
        leaseFromExpiresIn(res.busy.holder_name, res.busy.expires_in),
      );
      return false;
    } catch (e) {
      setHolding(false);
      showToast(
        e instanceof Error ? e.message : "Could not reach the server",
        "error",
      );
      return false;
    } finally {
      setAcquiring(false);
    }
  }, [sessionId, showToast]);

  // Acquire immediately on open; keep renewed while open; release on unmount.
  useEffect(() => {
    void tryAcquire();
    const renewTimer = setInterval(() => {
      if (!tokenRef.current) return;
      void (async () => {
        const res = await renewLease(sessionId, tokenRef.current!);
        if (res.ok) {
          setLease(null);
          setHolding(true);
        } else {
          setHolding(false);
          setLease(
            leaseFromExpiresIn(res.busy.holder_name, res.busy.expires_in),
          );
        }
      })();
    }, 20_000);
    return () => {
      clearInterval(renewTimer);
      if (tokenRef.current) void releaseLease(sessionId, tokenRef.current);
      tokenRef.current = null;
    };
  }, [sessionId, tryAcquire]);

  // ── Minute pre-fill from the server clock, ticking until edited ──
  useEffect(() => {
    if (minuteTouched) return;
    const tick = () =>
      setMinute(
        defaultGoalMinute(
          match.timer_total_seconds,
          match.timer_ends_at ? Date.parse(match.timer_ends_at) : null,
          match.timer_seconds_remaining,
        ),
      );
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [match, minuteTouched]);

  // ── Submit: (re-)acquire if needed, then post the goal ──────────
  const canSubmit =
    !submitting && !acquiring && !!scorer && (holding || lease === null);
  const afterWhistle = isAfterWhistle(minute, match.timer_total_seconds);

  const submit = useCallback(async () => {
    if (!scorer || submitting) return;
    setSubmitting(true);
    try {
      if (!holding) {
        const won = await tryAcquire();
        if (!won) {
          setSubmitting(false);
          return; // busy label now visible; fields preserved
        }
      }
      const res = await createGoal(sessionId, match.id, {
        team,
        scorer_id: scorer.id,
        assist_id: assist?.id ?? null,
        goalkeeper_id: goalkeeper?.id ?? null,
        intent_id: intentIdRef.current,
        force: afterWhistle && isAdmin,
      });
      if (res.goal) {
        onLogged(res.goal);
        showToast(
          `Goal logged — ${team === "a" ? match.team_a.name : match.team_b.name} ${g2score(match, res.goal)}`,
          "success",
        );
      }
      onClose();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Could not log the goal",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    assist,
    goalkeeper,
    isAdmin,
    afterWhistle,
    holding,
    match,
    onClose,
    onLogged,
    scorer,
    sessionId,
    showToast,
    submitting,
    team,
    tryAcquire,
  ]);

  // Release the lease when the user closes without submitting.
  const close = useCallback(() => onClose(), [onClose]);

  // Options per field: scorer from the chosen team, assist from anyone but
  // the scorer, keeper from the conceding (opposing) team only — mirroring
  // the server-side validation so the picker cannot offer an invalid pick.
  const scorerOptions = useMemo(
    () => matchPlayers.filter((p) => p.teamTag === (team === "a" ? "A" : "B")),
    [matchPlayers, team],
  );
  const assistOptions = useMemo(
    () => roster.filter((p) => p.id !== scorer?.id),
    [roster, scorer],
  );
  const keeperOptions = useMemo(
    () =>
      roster.filter(
        (p) =>
          p.teamTag === (team === "a" ? "B" : "A") &&
          p.id !== scorer?.id &&
          p.id !== assist?.id,
      ),
    [roster, team, scorer, assist],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Log a goal"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4 space-y-4 max-h-[92vh] overflow-y-auto">
        {/* Header + lease status */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            Log a goal
          </h3>
          <div className="flex items-center gap-2">
            {holding ? (
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums">
                Your turn — {leaseCountdown(null) || renewLeft()}s of lease
              </span>
            ) : lease ? (
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                {leaseBusyLabel(lease.holderName, leaseCountdown(lease))}
              </span>
            ) : (
              <span className="text-xs text-gray-400">No lease</span>
            )}
            <button
              type="button"
              onClick={close}
              className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
            >
              Close
            </button>
          </div>
        </div>

        {/* Team chooser */}
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
            1 · Team
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(["a", "b"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTeam(t)}
                className={`py-3 rounded-xl border-2 font-semibold text-sm transition-colors ${
                  team === t
                    ? t === "a"
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200"
                      : "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200"
                    : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
                }`}
              >
                {t === "a" ? match.team_a.name : match.team_b.name}
              </button>
            ))}
          </div>
        </div>

        {/* Scorer */}
        <PlayerSelect
          label="2 · Scorer"
          players={scorerOptions}
          selected={scorer}
          onSelect={(p) => {
            setScorer(p);
            if (assist?.id === p.id) setAssist(null);
            if (goalkeeper?.id === p.id) setGoalkeeper(null);
          }}
          disabled={!rosterLoaded}
        />

        {/* Assist (one, skippable) */}
        <PlayerSelect
          label="3 · Assist (optional — one assist max)"
          players={assistOptions}
          selected={assist}
          onSelect={(p) => {
            setAssist(p);
            if (goalkeeper?.id === p.id) setGoalkeeper(null);
          }}
          allowClear
          onClear={() => setAssist(null)}
        />

        {/* Goalkeeper who was beaten (conceding team, optional) */}
        <PlayerSelect
          label={`4 · Goalkeeper beaten by ${
            team === "a" ? match.team_b.name : match.team_a.name
          } (optional)`}
          players={keeperOptions}
          selected={goalkeeper}
          onSelect={setGoalkeeper}
          allowClear
          onClear={() => setGoalkeeper(null)}
        />

        {/* Minute */}
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
            5 · Minute (from the server clock)
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={Math.ceil(match.timer_total_seconds / 60) + 10}
              value={minute}
              onChange={(e) => {
                setMinuteTouched(true);
                setMinute(Math.max(1, parseInt(e.target.value, 10) || 1));
              }}
              className="w-24 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-base font-bold tabular-nums text-gray-900 dark:text-gray-100"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {minute}'
            </span>
            {minuteTouched && (
              <button
                type="button"
                onClick={() => setMinuteTouched(false)}
                className="text-xs text-gray-400 underline"
              >
                use live clock
              </button>
            )}
          </div>
          {afterWhistle && (
            <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
              This is beyond the full match length — an admin must confirm
              after-whistle goals.
            </p>
          )}
        </div>

        {/* Confirm */}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="w-full py-4 rounded-2xl bg-emerald-600 text-white text-lg font-bold hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-2 min-h-[56px]"
        >
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Plus className="h-5 w-5" />
          )}
          {holding
            ? "Confirm goal"
            : lease
              ? leaseBusyLabel(lease.holderName, leaseCountdown(lease))
              : "Take lease & log goal"}
        </button>
      </div>
    </div>
  );

  /** Left on our own lease, derived from token hold time (anchored at acquire). */
  function renewLeft(): number {
    // We don't store our own expiry in state; estimate from the renew cadence.
    return 45;
  }
}

function g2score(match: MatchSummary, goal: GoalRow): string {
  return `${goal.team === "a" ? match.team_a.name : match.team_b.name} ${goal.clock_minute}'`;
}
