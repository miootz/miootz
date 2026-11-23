import { Pencil, Volleyball } from "lucide-react";
import type { GoalRow } from "../api/stewardApi";

interface GoalListProps {
  goals: GoalRow[];
  /** Present members (or admin after the window) may tap a goal to edit it. */
  canEdit: boolean;
  onEdit: (goal: GoalRow) => void;
  emptyLabel?: string;
  showKeeper?: boolean;
}

/**
 * TV-broadcast goal list: `11'  Demo Player 03 (OG)` with the scorer aligned to the
 * scoring team's side, the scored minute to the left of the name, and the
 * assist as a muted subheader. Tapping a row opens the goal sheet in edit
 * mode (which carries the Delete button).
 */
export function GoalList({
  goals,
  canEdit,
  onEdit,
  emptyLabel = "No goals logged yet.",
  showKeeper = false,
}: GoalListProps) {
  if (goals.length === 0) {
    return <p className="text-sm text-ink-faint italic">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {goals.map((g) => {
        const sideA = g.team === "a";
        const minute = g.clock_minute > 0 ? `${g.clock_minute}′` : "";
        const minuteLabel = minute && (
          <span className="shrink-0 text-xs font-bold tabular-nums text-ink-faint">{minute}</span>
        );
        return (
          <li key={g.id}>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onEdit(g)}
              className={`w-full py-2.5 text-left transition-colors active:scale-[0.99] disabled:cursor-default ${
                canEdit ? "hover:bg-raised" : ""
              } ${showKeeper ? "min-h-12 px-2" : ""}`}
              aria-label={
                canEdit
                  ? `Edit goal: ${g.scorer.display_name}${minute ? ` at ${minute}` : ""}`
                  : undefined
              }
            >
              <span
                className={`flex items-baseline gap-2 ${
                  sideA ? "justify-start" : "justify-end"
                }`}
              >
                {sideA ? (
                  <>
                    <Volleyball className="h-3.5 w-3.5 shrink-0 self-center text-ink-faint" aria-hidden />
                    {minuteLabel}
                    <span
                      className={`text-sm font-bold truncate ${
                        sideA ? "text-team-a" : "text-team-b"
                      }`}
                    >
                      {g.scorer.display_name}
                      {g.is_own_goal ? " (OG)" : ""}
                    </span>
                  </>
                ) : (
                  /* Away (right) side is mirrored: name first, minute on the
                     right of the name, ball after the minute, right-aligned. */
                  <>
                    <span
                      className={`text-sm font-bold truncate ${
                        sideA ? "text-team-a" : "text-team-b"
                      }`}
                    >
                      {g.scorer.display_name}
                      {g.is_own_goal ? " (OG)" : ""}
                    </span>
                    {minuteLabel}
                    <Volleyball className="h-3.5 w-3.5 shrink-0 self-center text-ink-faint" aria-hidden />
                  </>
                )}
                {showKeeper && canEdit && <Pencil className="h-3.5 w-3.5 shrink-0 self-center text-ink-dim" aria-hidden />}
              </span>
              {g.assist && (
                <span
                  className={`flex items-baseline gap-2 ${
                    sideA ? "justify-start" : "justify-end"
                  }`}
                >
                  <span
                    className={`text-xs text-ink-faint truncate ${
                      sideA ? "pl-6" : "pr-6"
                    }`}
                  >
                    assist: {g.assist.display_name}
                  </span>
                </span>
              )}
              {showKeeper && g.goalkeeper && (
                <span className={`block text-xs text-ink-dim ${sideA ? "text-left" : "text-right"}`}>
                  Keeper: {g.goalkeeper.display_name}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
