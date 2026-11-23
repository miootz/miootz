import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Loader2, Plus, Trash2, X } from "lucide-react";
import { useToast } from "../context/ToastContext";
import {
  acquireLease,
  createGoal,
  releaseLease,
  renewLease,
  updateGoal,
  type GoalPerson,
  type GoalRow,
} from "../api/stewardApi";
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
  /** Present → edit mode: the sheet prefills from this goal and PATCHes it. */
  editGoal?: GoalRow | null;
  /** Only offered in edit mode — removes the goal row (light two-tap confirm). */
  onDeleteGoal?: (goal: GoalRow) => void;
}

type Side = "a" | "b";
type GoalStep = "scorer" | "assist" | "keeper" | "review";
type Scorer = SelectablePlayer & { side: Side };

const otherSide = (side: Side): Side => side === "a" ? "b" : "a";

function toPlayer(person: GoalPerson): SelectablePlayer {
  return { id: person.id, name: person.display_name, avatarUrl: person.avatar_url };
}

function liveMinute(match: MatchSummary): number {
  return defaultGoalMinute(
    match.timer_total_seconds,
    match.timer_ends_at ? Date.parse(match.timer_ends_at) : null,
    match.timer_seconds_remaining,
  );
}

const stepLabels: Record<GoalStep, string> = {
  scorer: "Choose scorer",
  assist: "Choose assist",
  keeper: "Choose goalkeeper",
  review: "Review goal",
};

export function GoalEntrySheet({
  meetupId,
  match,
  onClose,
  onLogged,
  editGoal = null,
  onDeleteGoal,
}: GoalEntrySheetProps) {
  const { showToast } = useToast();
  const isEdit = !!editGoal;

  // ── Idempotency: one intent per sheet meetup ──────────────────
  // crypto.randomUUID needs a secure context — plain-HTTP devices (phone on
  // a LAN/WireGuard IP) fall back to a timestamp+random id.
  const intentIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  // ── Lease state ──────────────────────────────────────────────────
  const [lease, setLease] = useState<LeaseInfo | null>(null); // someone else
  const [holding, setHolding] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const [step, setStep] = useState<GoalStep>(isEdit ? "review" : "scorer");
  const [isOwnGoal, setIsOwnGoal] = useState(editGoal?.is_own_goal ?? false);
  const [scorer, setScorer] = useState<Scorer | null>(editGoal ? {
    ...toPlayer(editGoal.scorer),
    side: editGoal.is_own_goal ? otherSide(editGoal.team) : editGoal.team,
  } : null);
  const [assist, setAssist] = useState(editGoal?.assist ? toPlayer(editGoal.assist) : null);
  const [goalkeeper, setGoalkeeper] = useState(editGoal?.goalkeeper ? toPlayer(editGoal.goalkeeper) : null);
  const [minute, setMinute] = useState<number | "">(() => editGoal?.clock_minute || liveMinute(match));
  const [submitting, setSubmitting] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const minuteId = useId();

  useEffect(() => { stepHeading.current?.focus(); }, [step]);

  const scoringSide = isOwnGoal ? otherSide(scorer?.side ?? "a") : (scorer?.side ?? "a");
  const concedingSide = otherSide(scoringSide);
  const teams = { a: match.team_a, b: match.team_b };
  const steps: GoalStep[] = isOwnGoal ? ["scorer", "keeper", "review"] : ["scorer", "assist", "keeper", "review"];
  const stepIndex = steps.indexOf(step);
  const previous = steps[stepIndex - 1];

  function goTo(next: GoalStep) {
    setConfirmDuplicate(false);
    setConfirmDelete(false);
    setStep(next);
  }

  function chooseScorer(player: SelectablePlayer, side: Side) {
    if (scorer?.side !== side || assist?.id === player.id) setAssist(null);
    if (scorer?.side !== side || goalkeeper?.id === player.id) setGoalkeeper(null);
    setScorer({ ...player, side });
    goTo(isOwnGoal ? "keeper" : "assist");
  }

  // ── Lease lifecycle: acquire on open, renew while open, release on close ─
  const tryAcquire = useCallback(async (): Promise<boolean> => {
    setAcquiring(true);
    try {
      const res = await acquireLease(meetupId, match.id);
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
  }, [meetupId, match.id, showToast]);

  // Acquire immediately on open; keep renewed while open; release on unmount.
  useEffect(() => {
    void tryAcquire();
    const renewTimer = setInterval(() => {
      if (!tokenRef.current) return;
      void (async () => {
        const res = await renewLease(meetupId, tokenRef.current!, match.id);
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
      if (tokenRef.current) void releaseLease(meetupId, tokenRef.current, match.id);
      tokenRef.current = null;
    };
  }, [meetupId, match.id, tryAcquire]);

  // ── Submit: (re-)acquire if needed, then post the goal ──────────
  const canSubmit =
    !submitting && !acquiring && !!scorer && (holding || lease === null);
  const afterWhistle = minute !== "" && isAfterWhistle(minute, match.timer_total_seconds);

  const postGoal = useCallback(
    async (force: boolean) => {
      if (!scorer || minute === "" || submitting) return;
      setSubmitting(true);
      setConfirmDuplicate(false);
      try {
        if (!holding) {
          const won = await tryAcquire();
          if (!won) return; // busy label now visible; fields preserved
        }
        const res = isEdit && editGoal
          ? await updateGoal(meetupId, match.id, editGoal.id, {
              team: scoringSide,
              scorer_id: scorer.id,
              assist_id: assist?.id ?? null,
              goalkeeper_id: goalkeeper?.id ?? null,
              clock_minute: minute,
              is_own_goal: isOwnGoal,
            })
          : await createGoal(meetupId, match.id, {
              team: scoringSide,
              scorer_id: scorer.id,
              assist_id: assist?.id ?? null,
              goalkeeper_id: goalkeeper?.id ?? null,
              clock_minute: minute,
              intent_id: intentIdRef.current,
              force: force || afterWhistle,
              is_own_goal: isOwnGoal,
            });
        if (res.goal) {
          onLogged(res.goal);
          showToast(
            isEdit
              ? `Goal updated — ${g2score(match, res.goal)}`
              : `Goal logged — ${g2score(match, res.goal)}`,
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
            e instanceof Error ? e.message : "Could not save the goal",
            "error",
          );
        }
      } finally {
        setSubmitting(false);
      }
    },
    [
      assist,
      editGoal,
      goalkeeper,
      isEdit,
      afterWhistle,
      holding,
      isOwnGoal,
      match,
      minute,
      onClose,
      onLogged,
      scorer,
      meetupId,
      showToast,
      scoringSide,
      submitting,
      tryAcquire,
    ],
  );

  const backButton = previous && (
    <button type="button" disabled={submitting} onClick={() => goTo(previous)}
      className="inline-flex min-h-12 items-center gap-2 border border-line px-3 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edit goal" : "Log a goal"}
    >
      <div className="w-full max-w-md bg-panel border border-line shadow-xl flex flex-col max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh]">
        {/* Header + lease status — pinned; only the content below scrolls */}
        <div className="flex items-center justify-between shrink-0 p-4 pb-2">
          <h3 className="shrink-0 text-lg font-bold text-ink">
            {isEdit ? "Edit goal" : "Log a goal"}
          </h3>
          <div className="flex min-w-0 items-center justify-end gap-2">
            {holding ? (
              <span className="text-xs font-semibold text-team-a tabular-nums">
                Your turn
              </span>
            ) : lease ? (
              <span className="text-right text-xs font-semibold text-live tabular-nums">
                {leaseBusyLabel(lease.holderName, leaseCountdown(lease))}
              </span>
            ) : (
              <span className="text-xs text-ink-faint">No lease</span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-ink-dim hover:bg-raised focus:outline-hidden focus:ring-2 focus:ring-live"
              aria-label="Close goal entry"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-4 pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 ref={stepHeading} tabIndex={-1} className="text-base font-bold text-ink">{stepLabels[step]}</h4>
            <span aria-current="step" className="text-xs tabular-nums text-ink-dim">
              Step {stepIndex + 1} of {steps.length}
            </span>
          </div>

          {step === "scorer" && (
            <>
              <label className="flex min-h-12 items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={isOwnGoal} onChange={(event) => {
                  setIsOwnGoal(event.target.checked);
                  setAssist(null);
                  setGoalkeeper(null);
                }} />
                Own goal
              </label>
              <div className="grid grid-cols-2 items-start gap-2">
                {(["a", "b"] as const).map((side) => (
                  <PlayerSelect key={side} label={teams[side].name} side={side}
                    players={teams[side].users.map(toPlayer)} selected={scorer}
                    onSelect={(player) => chooseScorer(player, side)} />
                ))}
              </div>
            </>
          )}

          {(step === "assist" || step === "keeper") && (
            <>
              <PlayerSelect label={teams[step === "assist" ? scoringSide : concedingSide].name}
                players={teams[step === "assist" ? scoringSide : concedingSide].users
                  .filter((player) => player.id !== scorer?.id && (step === "assist" || player.id !== assist?.id))
                  .map(toPlayer)}
                selected={step === "assist" ? assist : goalkeeper}
                onSelect={step === "assist"
                  ? (player) => { setAssist(player); goTo("keeper"); }
                  : (player) => { setGoalkeeper(player); goTo("review"); }}
              />
              <div className="flex flex-wrap justify-between gap-2">
                {backButton}
                <button type="button" onClick={() => {
                  if (step === "assist") {
                    setAssist(null);
                    goTo("keeper");
                  } else {
                    setGoalkeeper(null);
                    goTo("review");
                  }
                }} className="min-h-12 bg-ink px-4 py-2 text-sm font-bold text-board hover:bg-white/90">
                  {step === "assist" ? "Skip assist" : "Skip goalkeeper"}
                </button>
              </div>
            </>
          )}

          {step === "review" && (
            <form aria-label="Goal review" onSubmit={(event) => {
              event.preventDefault();
              void postGoal(confirmDuplicate);
            }} className="space-y-4">
              <div className="border border-line bg-raised px-3 py-2 font-semibold text-ink">
                Goal for {teams[scoringSide].name}
              </div>
              <div className="divide-y divide-line border border-line">
                {([
                  ["scorer", isOwnGoal ? "Own goal" : "Scorer", scorer],
                  ...(!isOwnGoal ? [["assist", "Assist", assist] as const] : []),
                  ["keeper", "Goalkeeper", goalkeeper],
                ] as const).map(([target, label, player]) => (
                  <button key={target} type="button" disabled={submitting} onClick={() => goTo(target)}
                    aria-label={`Change ${label.toLowerCase()}: ${player?.name ?? "Skipped"}`}
                    className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-raised">
                    <span className="shrink-0 text-ink-dim">{label}</span>
                    <span className="min-w-0 break-words text-right font-medium text-ink">{player?.name ?? "Skipped"}</span>
                  </button>
                ))}
              </div>
              <div>
                <label htmlFor={minuteId} className="mb-1 block text-sm font-medium text-ink">Goal minute</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input id={minuteId} name="minute" type="number" inputMode="numeric" required min={1}
                    max={Math.min(600, Math.ceil(match.timer_total_seconds / 60) + 10)} value={minute}
                    disabled={submitting} onChange={(event) => {
                      setMinute(event.target.value === "" ? "" : event.target.valueAsNumber);
                      setConfirmDuplicate(false);
                    }}
                    className="min-h-12 w-24 border border-line bg-raised px-3 py-2 text-base font-bold tabular-nums text-ink"
                  />
                  <button type="button" disabled={submitting} onClick={() => {
                    setMinute(liveMinute(match));
                    setConfirmDuplicate(false);
                  }} className="min-h-12 px-2 text-sm text-ink-dim underline hover:text-ink">
                    Use live clock
                  </button>
                </div>
                {afterWhistle && <p className="mt-1 text-sm text-live">This minute is after the scheduled match length.</p>}
              </div>

              {confirmDuplicate && (
                <p role="status" className="border border-live/40 bg-live/15 p-3 text-sm text-ink">
                  {scorer?.name} already has a goal in minute {minute}. Confirm to record another.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {backButton}
                <button type="submit" disabled={!canSubmit}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 bg-ink px-4 py-2 text-sm font-bold text-board hover:bg-white/90 disabled:opacity-50">
                  {submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Plus className="h-5 w-5" aria-hidden />}
                  {submitting ? "Saving…" : confirmDuplicate ? "Confirm second goal" : isEdit ? "Save changes" : "Confirm goal"}
                </button>
              </div>
              {editGoal && onDeleteGoal && (
                <button type="button" disabled={submitting} onClick={() => {
                  if (confirmDelete) onDeleteGoal(editGoal);
                  else setConfirmDelete(true);
                }} className="flex min-h-12 w-full items-center justify-center gap-2 border border-danger/40 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/10">
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {confirmDelete ? "Tap again to delete this goal" : "Delete goal"}
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );

}

function g2score(match: MatchSummary, goal: GoalRow): string {
  return `${goal.team === "a" ? match.team_a.name : match.team_b.name} ${goal.clock_minute}'`;
}
