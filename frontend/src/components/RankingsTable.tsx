import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { RankingRow, RankingSort } from "../api/rankingsApi";
import { Avatar } from "./Avatar";

const COLUMNS: { key: RankingSort; label: string; short: string; pct?: boolean }[] = [
  { key: "attendances", label: "Attendances", short: "Att." },
  { key: "goals", label: "Goals scored", short: "Goals" },
  { key: "assists", label: "Assists", short: "Assists" },
  { key: "wins", label: "Wins", short: "Wins" },
  { key: "matches", label: "Matches played", short: "Matches" },
  { key: "win_rate", label: "Win %", short: "Win %", pct: true },
  { key: "clean_sheets", label: "Clean sheets", short: "Clean" },
  { key: "goals_conceded", label: "Goals conceded", short: "Conceded" },
];

function cellValue(row: RankingRow, key: RankingSort, pct?: boolean): string {
  const v = row[key];
  if (pct) return `${Math.round(v * 100)}%`;
  return String(v);
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
  const mobileTabs = columns.filter((c) => c.key !== "clean_sheets");

  // Mobile tab (below sm); clean sheets lives in the wide table only.
  const [mobileTab, setMobileTab] = useState<RankingSort>(
    mobileTabs.find((c) => c.key === sort)?.key ?? mobileTabs[0]?.key ?? "goals",
  );
  // Follow external sort changes (desktop headers) so the tab reflects the sort.
  useEffect(() => {
    if (sort && mobileTabs.some((c) => c.key === sort)) setMobileTab(sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  if (rows.length === 0) {
    return <p className="text-center text-ink-dim py-8">{emptyLabel}</p>;
  }

  return (
    <div>
      {/* ── Mobile: tabs + single-metric list (below sm) ── */}
      <div className="sm:hidden">
        <div
          className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Ranking category"
        >
          {mobileTabs.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={mobileTab === c.key}
              onClick={() => {
                setMobileTab(c.key);
                // Switching category re-sorts by that metric (descending).
                if (sort !== c.key) onSortChange?.(c.key, "desc");
              }}
              className={`shrink-0 border px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                mobileTab === c.key
                  ? "border-live bg-live/15 text-live"
                  : "border-line text-ink-dim hover:bg-raised hover:text-ink"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
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
                {cellValue(r, mobileTab, mobileTabs.find((c) => c.key === mobileTab)?.pct)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Tablet / desktop: one sortable table (sm and up) ── */}
      <div className="hidden sm:block overflow-x-auto border border-line bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="px-3 py-2.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim w-10">
                #
              </th>
              <th className="px-3 py-2.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                Player
              </th>
              {columns.map((c) => (
                <SortableHeader
                  key={c.key}
                  label={c.short}
                  full={c.label}
                  active={sort === c.key}
                  order={order}
                  onSort={onSortChange ? () => onSortChange(c.key, order === "desc" ? "asc" : "desc") : undefined}
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
                <td className="px-3 py-2">
                  <PlayerBadge row={r} isMe={r.user.id === highlightUserId} />
                </td>
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-right tabular-nums text-ink">
                    {cellValue(r, c.key, c.pct)}
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
      <th className={`px-3 py-2.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim ${className}`}>
        {label}
      </th>
    );
  }
  return (
    <th className={`px-3 py-1.5 text-2xs font-bold uppercase tracking-wide ${className}`}>
      <button
        type="button"
        onClick={onSort}
        title={`Sort by ${full}`}
        aria-label={`Sort by ${full}`}
        className={`inline-flex items-center gap-0.5 min-h-[32px] transition-colors ${
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
