import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { MatchSummary } from "../api/matchesApi";
import { fetchMatch } from "../api/matchesApi";
import {
  deleteGoal,
  fetchHistoricalGoals,
  saveHistoricalGoal,
  type GoalRow,
  type HistoricalGoalLog,
} from "../api/stewardApi";
import { useToast } from "../context/ToastContext";
import { GoalList } from "./GoalList";
import { GoalEntryFlow } from "./GoalEntryFlow";

/**
 * Goals section for the admin history dialog — read-only list plus the
 * referee's step-by-step picker for adding and editing goals.
 *
 * Goal minutes are derived server-side, so the picker hides the minute field
 * (pass `showMinute={false}`) and the minute is not editable here.
 */
export function GoalsSection({
  meetupId,
  match,
  onScoreSaved,
}: {
  meetupId: number;
  match: MatchSummary;
  onScoreSaved: (score: { score_a: number; score_b: number }) => void;
}) {
  const [log, setLog] = useState<HistoricalGoalLog | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { showToast } = useToast();
  const [picker, setPicker] = useState<{ editing: GoalRow | null; addToScore: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchHistoricalGoals(meetupId, match.id).then(
      (result) => {
        if (!cancelled) setLog(result);
      },
      () => {
        if (!cancelled) setLoadError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [meetupId, match.id, attempt]);

  const teams = { a: match.team_a.name, b: match.team_b.name };
  const missing = {
    a: Math.max(0, match.score_a - (log?.goals.filter((goal) => goal.team === "a").length ?? 0)),
    b: Math.max(0, match.score_b - (log?.goals.filter((goal) => goal.team === "b").length ?? 0)),
  };
  const unassignedSides = (["a", "b"] as const).filter((side) => missing[side] > 0);

  if (picker) {
    const editing = picker.editing;
    return (
      <section aria-label="Goals" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-ink">{editing ? "Edit goal" : "Add goal"}</h3>
          <button
            type="button"
            onClick={() => setPicker(null)}
            className="min-h-12 px-3 text-sm text-ink-dim hover:text-ink"
          >
            Back
          </button>
        </div>
        <GoalEntryFlow
          match={match}
          editGoal={editing}
          canSubmit
          showMinute={false}
          onSubmit={async (input) => {
            const saved = await saveHistoricalGoal(meetupId, match.id, {
              goal_id: editing?.id,
              intent_id: input.intent_id,
              team: input.team,
              is_own_goal: input.is_own_goal,
              add_to_score: picker.addToScore && !editing,
              scorer_id: input.scorer_id,
              assist_id: input.assist_id,
              goalkeeper_id: input.goalkeeper_id,
            });
            onScoreSaved({ score_a: saved.score_a, score_b: saved.score_b });
            setAttempt((value) => value + 1);
            return saved.goal;
          }}
          onClose={() => setPicker(null)}
          onDeleteGoal={(goal) => {
            void (async () => {
              try {
                await deleteGoal(meetupId, match.id, goal.id);
                const updated = await fetchMatch(meetupId, match.id);
                onScoreSaved({ score_a: updated.score_a, score_b: updated.score_b });
                setAttempt((value) => value + 1);
                setPicker(null);
                showToast("Goal deleted.", "success");
              } catch (e) {
                showToast(
                  e instanceof Error ? e.message : "Could not delete the goal",
                  "error",
                );
              }
            })();
          }}
        />
      </section>
    );
  }

  return (
    <section aria-label="Goals" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Goals</h3>
        {log && (
          <button
            type="button"
            onClick={() => setPicker({ editing: null, addToScore: true })}
            className="inline-flex min-h-12 items-center gap-2 border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-raised"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden />
            Add goal
          </button>
        )}
      </div>
      {loadError && (
        <div className="flex items-center gap-3">
          <p role="alert" className="text-sm text-danger">Couldn’t load goal details.</p>
          <button
            type="button"
            className="min-h-12 px-3 text-sm text-ink underline"
            onClick={() => {
              setLoadError(false);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {!log && !loadError && <p role="status" className="text-sm text-ink-dim">Loading goals…</p>}
      {log && (
        <>
          <GoalList
            goals={log.goals}
            canEdit
            onEdit={(goal) => setPicker({ editing: goal, addToScore: false })}
            showKeeper
          />
          {unassignedSides.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {unassignedSides.map((side) => (
                <button
                  type="button"
                  key={side}
                  onClick={() => setPicker({ editing: null, addToScore: false })}
                  className="inline-flex min-h-12 items-center gap-2 border border-line px-3 py-2 text-left text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink"
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  Add scorer for {teams[side]}
                  <span className="text-xs tabular-nums">({missing[side]} unassigned)</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
