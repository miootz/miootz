import { useId, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { RankingRow, RankingSort } from "../api/rankingsApi";
import { Avatar } from "./Avatar";

type Column = {
  key: RankingSort;
  label: string;
  short: string;
  format?: "percent" | "rate" | "conversion";
};

const COLUMNS: Column[] = [
  { key: "attendances", label: "Attendances", short: "Att." },
  { key: "goals", label: "Goals scored", short: "Goals" },
  { key: "assists", label: "Assists", short: "Assists" },
  { key: "wins", label: "Wins", short: "Wins" },
  { key: "losses", label: "Losses", short: "Losses" },
  { key: "matches", label: "Matches played", short: "Matches" },
  { key: "win_rate", label: "Win rate", short: "Win %", format: "percent" },
  { key: "clean_sheets", label: "Clean sheets", short: "Clean" },
  { key: "goals_conceded", label: "Goals conceded", short: "Conceded" },
  { key: "own_goals", label: "Own goals", short: "Own goals" },
  { key: "goals_per_match", label: "Goals per match", short: "G / match", format: "rate" },
  { key: "assists_per_match", label: "Assists per match", short: "A / match", format: "rate" },
  { key: "goal_assists_per_match", label: "Goals + assists per match", short: "G+A / match", format: "rate" },
  { key: "penalties_taken", label: "Penalties taken", short: "Pens taken" },
  { key: "penalties_scored", label: "Penalties scored", short: "Pens scored" },
  { key: "penalty_conversion_rate", label: "Penalty conversion rate", short: "Pen %", format: "conversion" },
];

function cellValue(row: RankingRow, column: Column): string {
  const value = row[column.key];
  if (column.format === "percent") return `${Math.round(value * 100)}%`;
  if (column.format === "conversion") return `${Math.round(value * 1000) / 10}%`;
  if (column.format === "rate") return value.toFixed(2);
  return String(value);
}

interface RankingsTableProps {
  rows: RankingRow[];
  /** When provided, column headers sort (server- or client-side, caller's choice). */
  sort?: RankingSort;
  order?: "asc" | "desc";
  onSortChange?: (sort: RankingSort, order: "asc" | "desc") => void;
  /** Row belonging to the signed-in player gets a highlight. */
  highlightUserId?: number;
  emptyLabel?: string;
  /** Columns to hide entirely (e.g. attendances in a single-meetup scope). */
  excludeColumns?: RankingSort[];
}

export function RankingsTable({
  rows,
  sort,
  order = "desc",
  onSortChange,
  highlightUserId,
  emptyLabel = "No players with attendance in this scope.",
  excludeColumns = [],
}: RankingsTableProps) {
  const columns = COLUMNS.filter((c) => !excludeColumns.includes(c.key));
  const captionId = useId();
  const [mobileKey, setMobileKey] = useState<RankingSort>();
  const mobileColumn = columns.find((c) => c.key === (sort ?? mobileKey)) ?? columns[0];

  if (rows.length === 0) {
    return <p className="text-center text-ink-dim py-8">{emptyLabel}</p>;
  }

  return (
    <div>
      {/* ── Mobile: metric selector and single-metric list (below sm) ── */}
      <div className="sm:hidden">
        {mobileColumn && (
          <label className="flex items-center gap-2 text-sm text-ink-dim">
            {onSortChange ? "Rank by" : "Show"}
            <select
              value={mobileColumn.key}
              onChange={(event) => {
                const key = event.currentTarget.value as RankingSort;
                setMobileKey(key);
                onSortChange?.(key, "desc");
              }}
              className="min-h-11 min-w-0 flex-1 border border-line bg-panel px-3 font-medium text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-live"
            >
              {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
        )}
        <ul className="mt-2 divide-y divide-line border border-line bg-panel">
          {rows.map((r) => (
            <li
              key={r.user.id}
              className={`flex items-center gap-2.5 px-3 py-2 ${
                r.user.id === highlightUserId ? "bg-live/10" : ""
              }`}
            >
              <span className="w-6 text-right text-2xs font-bold text-ink-faint tabular-nums">
                {r.rank}
              </span>
              <PlayerBadge row={r} isMe={r.user.id === highlightUserId} />
              <span className="ml-auto text-base font-bold text-ink tabular-nums">
                {mobileColumn && cellValue(r, mobileColumn)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Tablet / desktop: one sortable table (sm and up) ── */}
      <div
        className="hidden sm:block overflow-x-auto border border-line bg-panel focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-live"
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
      >
        <table className="w-full whitespace-nowrap text-sm">
          <caption id={captionId} className="sr-only">Player rankings</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="px-3 py-2.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim w-10">
                #
              </th>
              <th scope="col" className="sticky start-0 z-10 bg-panel px-3 py-2.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                Player
              </th>
              {columns.map((c) => (
                <SortableHeader
                  key={c.key}
                  label={c.short}
                  full={c.label}
                  active={sort === c.key}
                  order={order}
                  onSort={onSortChange ? () => onSortChange(c.key, sort === c.key && order === "desc" ? "asc" : "desc") : undefined}
                  className="text-right"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.user.id}
                className={`border-b border-line last:border-b-0 ${
                  r.user.id === highlightUserId ? "bg-live/10" : ""
                }`}
              >
                <td className="px-3 py-2 text-2xs font-bold text-ink-faint tabular-nums">
                  {r.rank}
                </td>
                <th scope="row" className={`sticky start-0 z-10 min-w-36 px-3 py-2 text-left ${
                  r.user.id === highlightUserId ? "bg-raised" : "bg-panel"
                }`}>
                  <div className="max-w-48">
                    <PlayerBadge row={r} isMe={r.user.id === highlightUserId} />
                  </div>
                </th>
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-right tabular-nums text-ink">
                    {cellValue(r, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlayerBadge({ row, isMe }: { row: RankingRow; isMe?: boolean }) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      <Avatar url={row.user.avatar_url} username={row.user.display_name} size="sm" />
      <span className="truncate font-medium text-ink">{row.user.display_name}</span>
      {isMe && (
        <span className="text-2xs font-bold text-live shrink-0">You</span>
      )}
    </span>
  );
}

function SortableHeader({
  label,
  full,
  active,
  order,
  onSort,
  className = "",
}: {
  label: string;
  full: string;
  active: boolean;
  order: "asc" | "desc";
  onSort?: () => void;
  className?: string;
}) {
  if (!onSort) {
    return (
      <th scope="col" title={full} className={`px-3 py-2.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim ${className}`}>
        {label}
      </th>
    );
  }
  return (
    <th
      scope="col"
      aria-sort={active ? (order === "desc" ? "descending" : "ascending") : undefined}
      className={`text-2xs font-bold uppercase tracking-wide ${className}`}
    >
      <button
        type="button"
        onClick={onSort}
        title={`Sort by ${full}`}
        aria-label={`Sort by ${full}`}
        className={`inline-flex min-h-11 w-full items-center justify-end gap-0.5 px-3 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-live ${
          active ? "text-live" : "text-ink-dim hover:text-ink"
        }`}
      >
        {label}
        {active &&
          (order === "desc" ? (
            <ArrowDown className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ))}
      </button>
    </th>
  );
}
