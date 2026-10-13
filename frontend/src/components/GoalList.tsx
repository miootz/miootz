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
      <p className="text-sm text-gray-400 dark:text-gray-500 italic">
        {emptyLabel}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
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
            className="flex items-center gap-2 py-1.5 text-sm text-gray-800 dark:text-gray-200"
          >
            <span className="tabular-nums font-semibold shrink-0 text-gray-500 dark:text-gray-400">
              {g.clock_minute}'
            </span>
            <span aria-hidden>⚽</span>
            <span className="truncate">
              <span className="font-medium">{g.scorer.display_name}</span>
              {credit}
              <span className="text-gray-400 dark:text-gray-500">
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
                className={`ml-auto shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  confirmingId === g.id
                    ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300"
                    : "border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400"
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
