import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Plus } from "lucide-react";
import type { MatchSummary } from "../api/matchesApi";
import {
  fetchHistoricalGoals,
  saveHistoricalGoal,
  type GoalPerson,
  type GoalRow,
  type HistoricalGoalLog,
  type HistoricalGoalResult,
} from "../api/stewardApi";
import { useToast } from "../context/ToastContext";
import { GoalList } from "./GoalList";

type GoalSide = GoalRow["team"];
type GoalDraft = { side: GoalSide; goal?: GoalRow; intent: string; addToScore?: boolean };

export function HistoricalMatchGoals({ meetupId, match, onScoreSaved }: {
  meetupId: number;
  match: MatchSummary;
  onScoreSaved: (score: Omit<HistoricalGoalResult, "goal">) => void;
}) {
  const [log, setLog] = useState<HistoricalGoalLog | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const { showToast } = useToast();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let current = true;
    fetchHistoricalGoals(meetupId, match.id).then(
      (result) => { if (current) setLog(result); },
      () => { if (current) setLoadError(true); },
    );
    return () => { current = false; };
  }, [meetupId, match.id, attempt]);

  function openEditor(side: GoalSide, goal?: GoalRow, addToScore = false) {
    setDraft({ side, goal, intent: crypto.randomUUID(), addToScore });
  }

  function closeEditor() {
    setDraft(null);
    heading.current?.focus();
  }

  function onSaved({ goal, ...score }: HistoricalGoalResult) {
    setLog((previous) => previous && ({
      ...previous,
      goals: [...previous.goals.filter((row) => row.id !== goal.id), goal]
        .sort((a, b) => a.clock_minute - b.clock_minute || a.id - b.id),
    }));
    onScoreSaved(score);
    showToast(draft?.addToScore ? "Goal recorded" : "Goal details saved", "success");
    closeEditor();
  }

  const teams = { a: match.team_a.name, b: match.team_b.name };
  const missing = {
    a: Math.max(0, match.score_a - (log?.goals.filter((goal) => goal.team === "a").length ?? 0)),
    b: Math.max(0, match.score_b - (log?.goals.filter((goal) => goal.team === "b").length ?? 0)),
  };
  const unassignedSides = (["a", "b"] as const).filter((side) => missing[side] > 0);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 ref={heading} tabIndex={-1} className="text-sm font-bold text-ink">Goals</h3>
        {log && !draft && (
          <button type="button" onClick={() => openEditor("a", undefined, true)}
            className="inline-flex min-h-12 items-center gap-2 border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-raised">
            <Plus className="h-4 w-4 shrink-0" aria-hidden />
            New goal
          </button>
        )}
      </div>
      {loadError && (
        <div className="flex items-center gap-3">
          <p role="alert" className="text-sm text-danger">Couldn’t load goal details.</p>
          <button type="button" className="min-h-12 px-3 text-sm text-ink underline" onClick={() => {
            setLoadError(false);
            setAttempt((value) => value + 1);
          }}>Retry</button>
        </div>
      )}
      {!log && !loadError && <p role="status" className="text-sm text-ink-dim">Loading goals…</p>}
      {log && (
        <>
          <GoalList goals={log.goals} canEdit={!draft} onEdit={(goal) => openEditor(goal.team, goal)} showKeeper />
          {!draft && unassignedSides.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {unassignedSides.map((side) => (
                <button type="button" key={side} onClick={() => openEditor(side)}
                  className="inline-flex min-h-12 items-center gap-2 border border-line px-3 py-2 text-left text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink">
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  Add scorer for {teams[side]}
                  <span className="text-xs tabular-nums">({missing[side]} unassigned)</span>
                </button>
              ))}
            </div>
          )}
          {draft && (
            <GoalAttributionForm key={draft.intent} meetupId={meetupId} matchId={match.id}
              teams={teams} rosters={log.rosters} draft={draft}
              onCancel={closeEditor} onSaved={onSaved} />
          )}
        </>
      )}
    </section>
  );
}

function GoalAttributionForm({ meetupId, matchId, teams, rosters, draft, onCancel, onSaved }: {
  meetupId: number;
  matchId: number;
  teams: Record<GoalSide, string>;
  rosters: HistoricalGoalLog["rosters"];
  draft: GoalDraft;
  onCancel: () => void;
  onSaved: (result: HistoricalGoalResult) => void;
}) {
  const { goal, intent, addToScore } = draft;
  const headingId = useId();
  const scorerSelect = useRef<HTMLSelectElement>(null);
  const scoringTeamSelect = useRef<HTMLSelectElement>(null);
  const [side, setSide] = useState(draft.side);
  const [ownGoal, setOwnGoal] = useState(goal?.is_own_goal ?? false);
  const [scorer, setScorer] = useState(goal ? String(goal.scorer.id) : "");
  const [assist, setAssist] = useState(goal?.assist ? String(goal.assist.id) : "");
  const [keeper, setKeeper] = useState(goal?.goalkeeper ? String(goal.goalkeeper.id) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const scoring = rosters[side];
  const conceding = rosters[side === "a" ? "b" : "a"];

  useEffect(() => {
    (addToScore ? scoringTeamSelect : scorerSelect).current?.focus();
  }, [addToScore]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const saved = await saveHistoricalGoal(meetupId, matchId, {
        goal_id: goal?.id, intent_id: intent, team: side, is_own_goal: ownGoal,
        add_to_score: addToScore,
        scorer_id: Number(scorer), assist_id: assist ? Number(assist) : null,
        goalkeeper_id: keeper ? Number(keeper) : null,
      });
      onSaved(saved);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t save goal details.");
      setSaving(false);
    }
  }

  const choices = (players: GoalPerson[], original?: GoalPerson | null) => (
    (original && !players.some((player) => player.id === original.id) ? [...players, original] : players)
      .map((player) => <option key={player.id} value={player.id}>{player.display_name}</option>)
  );
  const selectClass = "block min-h-12 w-full border border-line bg-raised px-3 py-2 text-base text-ink";

  return (
    <form method="post" aria-labelledby={headingId} onSubmit={submit} className="border-t border-line pt-3">
      <h4 id={headingId} className="font-semibold text-ink">
        {addToScore ? "Record a new goal" : `${goal ? "Edit goal" : "Add scorer"} · ${teams[side]}`}
      </h4>
      <fieldset disabled={saving} className="mt-2 grid min-w-0 gap-3 disabled:opacity-60 sm:grid-cols-3">
        <legend className="sr-only">Goal details</legend>
        {addToScore && (
          <div className="min-w-0 sm:col-span-3">
            <label htmlFor={`${headingId}-team`} className="mb-1 block text-sm text-ink">Scoring team</label>
            <select id={`${headingId}-team`} ref={scoringTeamSelect} name="team" value={side} className={selectClass}
              onChange={(event) => {
                setSide(event.target.value === "b" ? "b" : "a");
                setScorer("");
                setAssist("");
                setKeeper("");
                setError("");
              }}>
              <option value="a">{teams.a}</option>
              <option value="b">{teams.b}</option>
            </select>
            <p className="mt-1 text-sm text-ink-dim">Adds one goal to the recorded score.</p>
          </div>
        )}
        <div className="flex min-h-12 items-center gap-2 sm:col-span-3">
          <input id={`${headingId}-own`} name="is_own_goal" type="checkbox" checked={ownGoal} onChange={(event) => {
            setOwnGoal(event.target.checked);
            setScorer("");
          }} />
          <label htmlFor={`${headingId}-own`} className="flex min-h-12 items-center text-sm text-ink">Own goal</label>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${headingId}-scorer`} className="mb-1 block text-sm text-ink">Scorer (required)</label>
          <select id={`${headingId}-scorer`} ref={scorerSelect} name="scorer_id" required value={scorer}
            onChange={(event) => setScorer(event.target.value)} className={selectClass}>
            <option value="">Select player</option>
            {choices(ownGoal ? conceding : scoring, ownGoal === !!goal?.is_own_goal ? goal?.scorer : null)}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${headingId}-assist`} className="mb-1 block text-sm text-ink">Assist</label>
          <select id={`${headingId}-assist`} name="assist_id" value={assist}
            onChange={(event) => setAssist(event.target.value)} className={selectClass}>
            <option value="">None or unknown</option>
            {choices(scoring, goal?.assist)}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${headingId}-keeper`} className="mb-1 block text-sm text-ink">Keeper scored on</label>
          <select id={`${headingId}-keeper`} name="goalkeeper_id" value={keeper}
            onChange={(event) => setKeeper(event.target.value)} className={selectClass}>
            <option value="">Unknown</option>
            {choices(conceding, goal?.goalkeeper)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <button type="submit" className="min-h-12 bg-ink px-4 py-2 text-sm font-bold text-board hover:bg-white/90">
            {saving ? "Saving…" : addToScore ? "Record goal" : "Save goal details"}
          </button>
          <button type="button" onClick={onCancel}
            className="min-h-12 border border-line px-4 py-2 text-sm text-ink-dim hover:bg-raised hover:text-ink">
            Cancel
          </button>
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </form>
  );
}
