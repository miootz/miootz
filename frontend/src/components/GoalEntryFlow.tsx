import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { useToast } from "../context/ToastContext";
import type { MatchSummary } from "../api/matchesApi";
import type { GoalPerson, GoalRow } from "../api/stewardApi";
import { PlayerSelect, type SelectablePlayer } from "./PlayerSelect";
import {
  defaultGoalMinute,
  isAfterWhistle,
} from "../utils/lease";

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
  scorer_id: number;
  assist_id: number | null;
  goalkeeper_id: number | null;
  is_own_goal: boolean;
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
  canSubmit,
  onSubmit,
  onClose,
  onDeleteGoal,
  showMinute = true,
}: {
  match: MatchSummary;
  editGoal?: GoalRow | null;
  canSubmit: boolean;
  onSubmit: (input: GoalSubmitInput) => Promise<GoalRow>;
  onClose: () => void;
  onDeleteGoal?: (goal: GoalRow) => void;
  /** Hide the minute field for flows that derive the minute server-side (e.g. admin history). */
  showMinute?: boolean;
}) {
  const { showToast } = useToast();
  const isEdit = !!editGoal;
  const intentIdRef = useRef<string>(newIntentId());

  const [step, setStep] = useState<GoalStep>(isEdit ? "review" : "scorer");
  const [isOwnGoal, setIsOwnGoal] = useState(editGoal?.is_own_goal ?? false);
  const [scorer, setScorer] = useState<Scorer | null>(editGoal ? {
    ...toPlayer(editGoal.scorer),
    side: editGoal.is_own_goal ? otherSide(editGoal.team) : editGoal.team,
  } : null);
  const [assist, setAssist] = useState(editGoal?.assist ? toPlayer(editGoal.assist) : null);
  const [goalkeeper, setGoalkeeper] = useState(editGoal?.goalkeeper ? toPlayer(editGoal.goalkeeper) : null);
  const [minute, setMinute] = useState<number>(() => editGoal?.clock_minute || liveMinute(match));
  const [submitting, setSubmitting] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const minuteLabelId = useId();

  useEffect(() => { stepHeading.current?.focus(); }, [step]);

  const scoringSide = isOwnGoal ? otherSide(scorer?.side ?? "a") : (scorer?.side ?? "a");
  const concedingSide = otherSide(scoringSide);
  const teams = { a: match.team_a, b: match.team_b };
  const steps: GoalStep[] = isOwnGoal ? ["scorer", "keeper", "review"] : ["scorer", "assist", "keeper", "review"];
  const stepIndex = steps.indexOf(step);
  const previous = steps[stepIndex - 1];
  const maxMinute = Math.min(600, Math.ceil(match.timer_total_seconds / 60) + 10);

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

  const afterWhistle = showMinute && isAfterWhistle(minute, match.timer_total_seconds);

  const postGoal = useCallback(
    async (force: boolean) => {
      if (!scorer || submitting) return;
      setSubmitting(true);
      setConfirmDuplicate(false);
      try {
        const saved = await onSubmit({
          team: scoringSide,
          scorer_id: scorer.id,
          assist_id: assist?.id ?? null,
          goalkeeper_id: goalkeeper?.id ?? null,
          is_own_goal: isOwnGoal,
          minute,
          intent_id: intentIdRef.current,
          force: force || afterWhistle,
        });
        showToast(
          isEdit
            ? `Goal updated — ${g2score(match, saved)}`
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
      afterWhistle,
      goalkeeper,
      isEdit,
      isOwnGoal,
      match,
      minute,
      onClose,
      onSubmit,
      scorer,
      scoringSide,
      submitting,
      showToast,
    ],
  );

  const canSubmitNow = canSubmit && !submitting && !!scorer;

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
      {submitting ? "Saving…" : confirmDuplicate ? "Confirm second goal" : isEdit ? "Save changes" : "Confirm goal"}
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
          <section aria-label="Goal review" className="space-y-4">
            <div className="border border-line bg-raised px-3 py-2 font-semibold text-ink">
              Goal for {teams[scoringSide].name}
            </div>
            <div className="divide-y divide-line border border-line">
              {([
                ["scorer", isOwnGoal ? "Own goal" : "Scorer", scorer],
                ...(!isOwnGoal ? [["assist", "Assist", assist] as const] : []),
                ["keeper", "Goalkeeper", goalkeeper],
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
                <p id={minuteLabelId} className="mb-1 text-sm font-medium text-ink">Goal minute</p>
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
                {scorer?.name} already has a goal in minute {minute}. Confirm to record another.
              </p>
            )}
          </section>
        )}
      </div>

      {step === "review" && (
        <div className="shrink-0 border-t border-line bg-panel px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2">
            {backButton}
            {submitButton}
          </div>
          {editGoal && onDeleteGoal && (
            <button type="button" disabled={submitting} onClick={() => {
              if (confirmDelete) onDeleteGoal(editGoal);
              else setConfirmDelete(true);
            }} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 border border-danger/40 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/10">
              <Trash2 className="h-4 w-4" aria-hidden />
              {confirmDelete ? "Tap again to delete this goal" : "Delete goal"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
