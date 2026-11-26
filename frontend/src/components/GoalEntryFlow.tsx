import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { useToast } from "../context/ToastContext";
import type { MatchSummary } from "../api/matchesApi";
import type { GoalPerson, GoalRow } from "../api/stewardApi";
import { PlayerSelect, type SelectablePlayer } from "./PlayerSelect";
import { ToggleSwitch } from "./ToggleSwitch";
import {
  defaultGoalMinute,
  isAfterWhistle,
} from "../utils/lease";

type Side = "a" | "b";
type GoalStep = "scorer" | "assist" | "keeper" | "review";

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

function g2score(match: MatchSummary, goal: GoalRow): string {
  return `${goal.team === "a" ? match.team_a.name : match.team_b.name} ${goal.clock_minute}'`;
}

function newIntentId(): string {
  // crypto.randomUUID needs a secure context — plain-HTTP devices (phone on
  // a LAN/WireGuard IP) fall back to a timestamp+random id.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface GoalSubmitInput {
  team: Side;
  scorer_id: number | null;
  assist_id: number | null;
  goalkeeper_id: number | null;
  is_own_goal: boolean;
  is_penalty: boolean;
  missed: boolean;
  minute: number;
  intent_id: string;
  force: boolean;
}

/**
 * The goal-entry picker — scorer → assist → goalkeeper → review, shared by
 * the referee live sheet and the admin history dialog. The caller owns the
 * save path (live lease or historical attribution) and the modal/inline
 * presentation; this owns the step flow, validation, and a sticky footer
 * with the confirm/delete actions at the review step.
 *
 * No keyboard-opening inputs: the minute is a tap-driven stepper.
 */
export function GoalEntryFlow({
  match,
  editGoal = null,
  fixedScoringSide,
  rosters,
  canSubmit,
  onSubmit,
  onClose,
  onDeleteGoal,
  showMinute = true,
  allowMiss = true,
}: {
  match: MatchSummary;
  editGoal?: GoalRow | null;
  fixedScoringSide?: Side;
  rosters?: Record<Side, GoalPerson[]>;
  canSubmit: boolean;
  onSubmit: (input: GoalSubmitInput) => Promise<GoalRow | null>;
  onClose: () => void;
  onDeleteGoal?: (goal: GoalRow) => Promise<void>;
  /** Hide the minute field for flows that derive the minute server-side (e.g. admin history). */
  showMinute?: boolean;
  /** Missed penalties are recorded in the live flow, not as historical goals. */
  allowMiss?: boolean;
}) {
  const { showToast } = useToast();
  const isEdit = !!editGoal;
  const intentIdRef = useRef<string>(newIntentId());

  const [step, setStep] = useState<GoalStep>(isEdit ? "review" : "scorer");
  const [isOwnGoal, setIsOwnGoal] = useState(editGoal?.is_own_goal ?? false);
  const [isPenalty, setIsPenalty] = useState(editGoal?.is_penalty ?? false);
  const [missed, setMissed] = useState(false);
  const [scorer, setScorer] = useState<SelectablePlayer | null>(
    editGoal?.scorer ? toPlayer(editGoal.scorer) : null,
  );
  const [selectedTeam, setSelectedTeam] = useState<Side | null>(editGoal?.team ?? null);
  const [assist, setAssist] = useState(editGoal?.assist ? toPlayer(editGoal.assist) : null);
  const [goalkeeper, setGoalkeeper] = useState(editGoal?.goalkeeper ? toPlayer(editGoal.goalkeeper) : null);
  const [minute, setMinute] = useState<number>(() => editGoal?.clock_minute || liveMinute(match));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const minuteLabelId = useId();

  useEffect(() => { stepHeading.current?.focus(); }, [step]);

  const lockedTeam = fixedScoringSide;
  const scoringSide = lockedTeam ?? selectedTeam;
  const concedingSide = scoringSide ? otherSide(scoringSide) : null;
  const teams = { a: match.team_a, b: match.team_b };
  const scorerSides = lockedTeam ? [isOwnGoal ? otherSide(lockedTeam) : lockedTeam] : (["a", "b"] as const);
  const detailSide = step === "assist" ? scoringSide : concedingSide;
  const steps: GoalStep[] = missed ? ["scorer", "review"] : isOwnGoal || isPenalty
    ? ["scorer", "keeper", "review"] : ["scorer", "assist", "keeper", "review"];
  const stepIndex = steps.indexOf(step);
  const previous = steps[stepIndex - 1];
  const maxMinute = Math.min(600, Math.ceil(match.timer_total_seconds / 60) + 10);

  function goTo(next: GoalStep) {
    setConfirmDuplicate(false);
    setConfirmDelete(false);
    setError("");
    setStep(next);
  }

  function chooseScorer(player: SelectablePlayer | null, team: Side) {
    if (scoringSide !== team || assist?.id === player?.id) setAssist(null);
    if (scoringSide !== team || goalkeeper?.id === player?.id) setGoalkeeper(null);
    setSelectedTeam(team);
    setScorer(player);
    goTo(missed ? "review" : isOwnGoal || isPenalty ? "keeper" : "assist");
  }

  const afterWhistle = showMinute && isAfterWhistle(minute, match.timer_total_seconds);

  async function postGoal(force: boolean) {
    if (!scoringSide || !canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    setConfirmDuplicate(false);
    try {
      const saved = await onSubmit({
        team: scoringSide,
        scorer_id: scorer?.id ?? null,
        assist_id: isOwnGoal || isPenalty ? null : assist?.id ?? null,
        goalkeeper_id: missed ? null : goalkeeper?.id ?? null,
        is_own_goal: isOwnGoal,
        is_penalty: isPenalty,
        missed,
        minute,
        intent_id: intentIdRef.current,
        force: force || afterWhistle,
      });
      showToast(
        saved == null
          ? "Penalty miss logged — not in the match score"
          : isEdit ? `Goal updated — ${g2score(match, saved)}`
          : `Goal logged — ${g2score(match, saved)}`,
        "success",
      );
      onClose();
    } catch (e) {
      if (e instanceof Error && e.message === "busy") {
        // The header chip shows the busy state; keep the fields, stay quiet.
        return;
      }
      if (e instanceof Error && e.message === "duplicate_goal_within_90s") {
        // A live same-minute goal exists: let the user confirm a second one
        // (force re-send) instead of silently dropping it.
        setConfirmDuplicate(true);
      } else {
        setError(e instanceof Error ? e.message : "Could not save the goal.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function removeGoal() {
    if (!editGoal || !onDeleteGoal || submitting) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onDeleteGoal(editGoal);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the goal.");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmitNow = canSubmit && !submitting && !!scoringSide && (!missed || !!scorer);

  const backButton = previous && (
    <button type="button" disabled={submitting} onClick={() => goTo(previous)}
      className="inline-flex min-h-12 items-center gap-2 border border-line px-3 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back
    </button>
  );

  const submitButton = (
    <button type="button" onClick={() => void postGoal(confirmDuplicate)} disabled={!canSubmitNow}
      className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 bg-ink px-4 py-2 text-sm font-bold text-board hover:bg-white/90 disabled:opacity-50">
      {submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Plus className="h-5 w-5" aria-hidden />}
      {submitting ? "Saving…" : missed ? "Log penalty miss" : confirmDuplicate ? "Confirm second goal" : isEdit ? "Save changes" : "Confirm goal"}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 ref={stepHeading} tabIndex={-1} className="text-base font-bold text-ink">{stepLabels[step]}</h4>
          <span aria-current="step" className="text-xs tabular-nums text-ink-dim">
            Step {stepIndex + 1} of {steps.length}
          </span>
        </div>

        {step === "scorer" && (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <div className="flex min-h-12 items-center gap-2 text-sm text-ink">
                <ToggleSwitch enabled={isOwnGoal} ariaLabel="Own goal" onChange={() => {
                  setIsOwnGoal(!isOwnGoal);
                  setIsPenalty(false);
                  setMissed(false);
                  setScorer(null);
                  setAssist(null);
                  setGoalkeeper(null);
                }} />
                <span>Own goal</span>
              </div>
              <div className="flex min-h-12 items-center gap-2 text-sm text-ink">
                <ToggleSwitch enabled={isPenalty} ariaLabel="Penalty" onChange={() => {
                  setIsPenalty(!isPenalty);
                  setIsOwnGoal(false);
                  setMissed(false);
                  setScorer(null);
                  setAssist(null);
                  setGoalkeeper(null);
                }} />
                <span>Penalty</span>
              </div>
              {isPenalty && allowMiss && !isEdit && (
                <div className="flex min-h-12 items-center gap-2 text-sm text-ink">
                  <ToggleSwitch enabled={missed} ariaLabel="Miss" onChange={() => {
                    setMissed(!missed);
                    setAssist(null);
                    setGoalkeeper(null);
                  }} />
                  <span>Miss</span>
                </div>
              )}
            </div>
            {missed && <p className="text-sm text-ink-dim">A miss counts toward penalty statistics, but not the match score. Select the taker.</p>}
            <div className={lockedTeam ? "" : "grid grid-cols-2 items-start gap-2"}>
              {scorerSides.map((side) => {
                const goalTeam = isOwnGoal ? otherSide(side) : side;
                return (
                  <div key={side} className="min-w-0 space-y-2">
                    <PlayerSelect label={teams[side].name} side={side}
                      players={(rosters?.[side] ?? teams[side].users).map(toPlayer)} selected={scorer}
                      onSelect={(player) => chooseScorer(player, goalTeam)} />
                    {!missed && <button type="button" onClick={() => chooseScorer(null, goalTeam)}
                      aria-label={`Skip scorer, goal for ${teams[goalTeam].name}`}
                      className="min-h-12 w-full border border-line px-2 text-sm font-medium text-ink hover:bg-raised">
                      {isOwnGoal && !lockedTeam ? `Skip scorer · Goal for ${teams[goalTeam].name}` : "Skip scorer"}
                    </button>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {(step === "assist" || step === "keeper") && detailSide && (
          <>
            <PlayerSelect label={teams[detailSide].name}
              players={(rosters?.[detailSide] ?? teams[detailSide].users)
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

        {step === "review" && scoringSide && (
          <section aria-label="Goal review" className="space-y-4">
            <div className="border border-line bg-raised px-3 py-2 font-semibold text-ink">
              {missed ? "Penalty miss" : isPenalty ? "Penalty goal" : "Goal"} for {teams[scoringSide].name}
            </div>
            <div className="divide-y divide-line border border-line">
              {([
                ["scorer", isOwnGoal ? "Own goal" : "Scorer", scorer],
                ...(!isOwnGoal && !isPenalty ? [["assist", "Assist", assist] as const] : []),
                ...(!missed ? [["keeper", "Goalkeeper", goalkeeper] as const] : []),
              ] as const).map(([target, label, player]) => (
                <button key={target} type="button" disabled={submitting} onClick={() => goTo(target as GoalStep)}
                  aria-label={`Change ${label.toLowerCase()}: ${player?.name ?? "Skipped"}`}
                  className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-raised">
                  <span className="shrink-0 text-ink-dim">{label}</span>
                  <span className="min-w-0 break-words text-right font-medium text-ink">{player?.name ?? "Skipped"}</span>
                </button>
              ))}
            </div>
            {showMinute && (
              <div>
                <p id={minuteLabelId} className="mb-1 text-sm font-medium text-ink">{missed ? "Penalty minute" : "Goal minute"}</p>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={minuteLabelId}>
                  <button type="button" disabled={submitting || minute <= 1}
                    onClick={() => { setMinute((m) => Math.max(1, m - 1)); setConfirmDuplicate(false); }}
                    className="grid h-12 w-12 shrink-0 place-items-center border border-line bg-raised text-ink hover:bg-raised/70 disabled:opacity-40"
                    aria-label="Decrease minute">
                    <Minus className="h-4 w-4" aria-hidden />
                  </button>
                  <span className="min-w-[3ch] text-center text-2xl font-extrabold tabular-nums text-ink">
                    {minute}′
                  </span>
                  <button type="button" disabled={submitting || minute >= maxMinute}
                    onClick={() => { setMinute((m) => Math.min(maxMinute, m + 1)); setConfirmDuplicate(false); }}
                    className="grid h-12 w-12 shrink-0 place-items-center border border-line bg-raised text-ink hover:bg-raised/70 disabled:opacity-40"
                    aria-label="Increase minute">
                    <Plus className="h-4 w-4" aria-hidden />
                  </button>
                  <button type="button" disabled={submitting} onClick={() => {
                    setMinute(liveMinute(match));
                    setConfirmDuplicate(false);
                  }} className="min-h-12 px-2 text-sm text-ink-dim underline hover:text-ink">
                    Use live clock
                  </button>
                </div>
                {afterWhistle && <p className="mt-1 text-sm text-live">This minute is after the scheduled match length.</p>}
              </div>
            )}

            {confirmDuplicate && (
              <p role="status" className="border border-live/40 bg-live/15 p-3 text-sm text-ink">
                {scorer ? `${scorer.name} already has` : `${teams[scoringSide].name} already has`} a goal in minute {minute}. Confirm to record another.
              </p>
            )}
          </section>
        )}
      </div>

      {step === "review" && (
        <div className="shrink-0 border-t border-line bg-panel px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p role="status" className={error ? "mb-2 text-sm text-danger" : "sr-only"}>{error}</p>
          <div className="flex items-center gap-2">
            {backButton}
            {submitButton}
          </div>
          {editGoal && onDeleteGoal && (
            <button type="button" disabled={submitting} onClick={() => void removeGoal()}
              className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 border border-danger/40 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/10">
              <Trash2 className="h-4 w-4" aria-hidden />
              {confirmDelete ? "Tap again to delete this goal" : "Delete goal"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
