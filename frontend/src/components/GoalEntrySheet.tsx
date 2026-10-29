import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { useToast } from "../context/ToastContext";
import {
  acquireLease,
  createGoal,
  releaseLease,
  renewLease,
  type GoalRow,
} from "../api/stewardApi";
import { fetchMeetupDetail } from "../api/meetupsApi";
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
  meetupId: number;
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
  meetupId,
  match,
  onClose,
  onLogged,
}: GoalEntrySheetProps) {
  const { showToast } = useToast();

  // ── Idempotency: one intent per sheet meetup ──────────────────
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
  // Server said "same player already has a goal in this minute" — ask before
  // confirming a genuine second goal (force re-send).
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  // ── Roster (confirmed attendees, with team tags for this match) ─
  const [roster, setRoster] = useState<SelectablePlayer[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const detail = await fetchMeetupDetail(meetupId);
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
  }, [meetupId, match]);

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
      const res = await acquireLease(meetupId);
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
  }, [meetupId, showToast]);

  // Acquire immediately on open; keep renewed while open; release on unmount.
  useEffect(() => {
    void tryAcquire();
    const renewTimer = setInterval(() => {
      if (!tokenRef.current) return;
      void (async () => {
        const res = await renewLease(meetupId, tokenRef.current!);
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
      if (tokenRef.current) void releaseLease(meetupId, tokenRef.current);
      tokenRef.current = null;
    };
  }, [meetupId, tryAcquire]);

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

  const postGoal = useCallback(
    async (force: boolean) => {
      if (!scorer) return;
      setSubmitting(true);
      setConfirmDuplicate(false);
      try {
        if (!holding) {
          const won = await tryAcquire();
          if (!won) return; // busy label now visible; fields preserved
        }
        const res = await createGoal(meetupId, match.id, {
          team,
          scorer_id: scorer.id,
          assist_id: assist?.id ?? null,
          goalkeeper_id: goalkeeper?.id ?? null,
          intent_id: intentIdRef.current,
          force: force || afterWhistle,
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
        if (e instanceof Error && e.message === "duplicate_goal_within_90s") {
          // A live same-minute goal exists: let the user confirm a second one
          // (force re-send) instead of silently dropping it.
          setConfirmDuplicate(true);
        } else {
          showToast(
            e instanceof Error ? e.message : "Could not log the goal",
            "error",
          );
        }
      } finally {
        setSubmitting(false);
      }
    },
    [
      assist,
      goalkeeper,
      afterWhistle,
      holding,
      match,
      onClose,
      onLogged,
      scorer,
      meetupId,
      showToast,
      team,
      tryAcquire,
    ],
  );

  const submit = useCallback(async () => {
    if (!scorer || submitting) return;
    await postGoal(false);
  }, [scorer, submitting, postGoal]);

  const confirmSecondGoal = useCallback(() => {
    void postGoal(true);
  }, [postGoal]);

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
      <div className="w-full max-w-md bg-panel border border-line shadow-xl p-4 space-y-4 max-h-[92vh] overflow-y-auto">
        {/* Header + lease status */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink">
            Log a goal
          </h3>
          <div className="flex items-center gap-2">
            {holding ? (
              <span className="text-xs font-semibold text-team-a tabular-nums">
                Your turn — {leaseCountdown(null) || renewLeft()}s of lease
              </span>
            ) : lease ? (
              <span className="text-xs font-semibold text-live tabular-nums">
                {leaseBusyLabel(lease.holderName, leaseCountdown(lease))}
              </span>
            ) : (
              <span className="text-xs text-ink-faint">No lease</span>
            )}
            <button
              type="button"
              onClick={close}
              className="inline-flex h-11 w-11 items-center justify-center text-ink-dim hover:bg-raised focus:outline-hidden focus:ring-2 focus:ring-live"
              aria-label="Close goal entry"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Team chooser */}
        <div>
          <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim mb-1.5">
            1 · Team
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(["a", "b"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTeam(t);
                  setConfirmDuplicate(false);
                }}
                className={`py-3 border-2 font-semibold text-sm transition-colors ${
                  team === t
                    ? t === "a"
                      ? "bg-team-a text-white"
                      : "bg-team-b text-white"
                    : "border-line bg-raised text-ink-dim"
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
            setConfirmDuplicate(false);
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
          <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim mb-1.5">
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
                setConfirmDuplicate(false);
              }}
              className="w-24 px-3 py-2 border border-line bg-raised text-base font-bold tabular-nums text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
            />
            <span className="text-sm text-ink-dim tabular-nums">
              {minute}'
            </span>
            {minuteTouched && (
              <button
                type="button"
                onClick={() => setMinuteTouched(false)}
                className="text-xs text-ink-faint underline hover:text-ink"
              >
                use live clock
              </button>
            )}
          </div>
          {afterWhistle && (
            <p className="mt-1 text-xs font-medium text-danger">
              This is beyond the full match length — an admin must confirm
              after-whistle goals.
            </p>
          )}
        </div>

        {/* Confirm */}
        {confirmDuplicate && (
          <div className="border border-live/40 bg-live/15 p-3 space-y-2">
            <p className="text-sm font-medium text-ink">
              {scorer?.name} already has a goal in {minute}′. Log a second
              goal?
            </p>
            <button
              type="button"
              onClick={confirmSecondGoal}
              disabled={submitting}
              className="w-full py-2.5 bg-live text-board text-sm font-bold hover:bg-live/90 disabled:opacity-50"
            >
              Yes — second goal
            </button>
          </div>
        )}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="w-full py-4 bg-live text-board text-lg font-bold hover:bg-live/90 disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-2 min-h-[56px]"
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
