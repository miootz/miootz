import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import type { GoalRow } from "../api/stewardApi";

interface GoalListProps {
  goals: GoalRow[];
  teamAName: string;
  teamBName: string;
  /** Present members (or admin after the window) may delete; light confirm inline. */
  canDelete: boolean;
  onDelete: (goal: GoalRow) => Promise<void>;
  emptyLabel?: string;
}

/**
 * Goal log rows: `33' ⚽ Ana (assist Carlos · beaten Bob) · logged by Ben  [delete]`
 * (plan §6). Delete uses a light two-tap confirm inside the row.
 */
export function GoalList({
  goals,
  teamAName,
  teamBName,
  canDelete,
  onDelete,
  emptyLabel = "No goals logged yet.",
}: GoalListProps) {
  // id whose delete button is in "confirm?" state + expiry.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  if (goals.length === 0) {
    return (
      <p className="text-sm text-ink-faint italic">
        {emptyLabel}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {goals.map((g) => {
        const teamName = g.team === "a" ? teamAName : teamBName;
        // Credit line: "(assist Carlos · beaten Bob)" — parts omitted when unknown.
        const credits: string[] = [];
        if (g.assist) credits.push(`assist ${g.assist.display_name}`);
        if (g.goalkeeper) credits.push(`beaten ${g.goalkeeper.display_name}`);
        const credit = credits.length ? ` (${credits.join(" · ")})` : "";
        const whistle = g.after_whistle ? " after whistle" : "";
        return (
          <li
            key={g.id}
            className="flex items-center gap-2 py-1.5 text-sm text-ink"
          >
            <span className="tabular-nums font-semibold shrink-0 text-live">
              {g.clock_minute}'
            </span>
            <span aria-hidden>⚽</span>
            <span className="truncate">
              <span className="font-medium text-ink">{g.scorer.display_name}</span>
              {g.is_own_goal && (
                <span
                  title="Own goal — scored against the listed team"
                  className="ml-1 inline-block px-1 text-2xs font-bold bg-raised border border-line text-ink-dim align-middle"
                >
                  OG
                </span>
              )}
              {credit}
              <span className="text-ink-faint">
                {" "}
                · {teamName}
                {whistle} · logged by {g.recorded_by.display_name}
              </span>
            </span>
            {canDelete && (
              <button
                type="button"
                disabled={deletingId === g.id}
                aria-label={`Delete goal by ${g.scorer.display_name} at ${g.clock_minute}'`}
                onClick={() => {
                  if (confirmingId !== g.id) {
                    setConfirmingId(g.id);
                    return;
                  }
                  setConfirmingId(null);
                  setDeletingId(g.id);
                  void onDelete(g).finally(() => setDeletingId(null));
                }}
                onBlur={() => setConfirmingId((id) => (id === g.id ? null : id))}
                className={`ml-auto shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border transition-colors ${
                  confirmingId === g.id
                    ? "border-danger/40 bg-danger/15 text-danger"
                    : "border-line text-ink-faint hover:text-danger"
                }`}
              >
                {confirmingId === g.id ? (
                  <>
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Confirm?
                  </>
                ) : (
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
