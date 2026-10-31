import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { RankingRow, RankingSort } from "../api/rankingsApi";

const COLUMNS: { key: RankingSort; label: string; short: string }[] = [
  { key: "attendances", label: "Attendances", short: "Att." },
  { key: "goals", label: "Goals scored", short: "Goals" },
  { key: "assists", label: "Assists", short: "Assists" },
  { key: "clean_sheets", label: "Clean sheets", short: "Clean" },
  { key: "goals_conceded", label: "Goals conceded", short: "Conceded" },
];

// Mobile tabs: clean sheets are a team credit and only show in the wide table.
const MOBILE_TABS = COLUMNS.filter((c) => c.key !== "clean_sheets");

interface RankingsTableProps {
  rows: RankingRow[];
  /** When provided, column headers sort (server- or client-side, caller's choice). */
  sort?: RankingSort;
  order?: "asc" | "desc";
  onSortChange?: (sort: RankingSort, order: "asc" | "desc") => void;
  /** Row belonging to the signed-in player gets a highlight. */
  highlightUserId?: number;
  emptyLabel?: string;
}

export function RankingsTable({
  rows,
  sort,
  order = "desc",
  onSortChange,
  highlightUserId,
  emptyLabel = "No players with attendance in this scope.",
}: RankingsTableProps) {
  // Mobile tab (below sm); clean sheets lives in the wide table only.
  const [mobileTab, setMobileTab] = useState<RankingSort>(
    MOBILE_TABS.find((c) => c.key === sort)?.key ?? "attendances",
  );

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
          {MOBILE_TABS.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={mobileTab === c.key}
              onClick={() => setMobileTab(c.key)}
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
              <PlayerBadge row={r} />
              <span className="ml-auto text-base font-bold text-ink tabular-nums">
                {r[mobileTab]}
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
              <th className="px-3 py-2.5 text-2xs font-bold uppercase tracking-wide text-ink-faint w-10">
                #
              </th>
              <th className="px-3 py-2.5 text-2xs font-bold uppercase tracking-wide text-ink-faint">
                Player
              </th>
              {COLUMNS.map((c) => (
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
                  <PlayerBadge row={r} />
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-right tabular-nums text-ink">
                    {r[c.key]}
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

function PlayerBadge({ row }: { row: RankingRow }) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      {row.user.avatar_url ? (
        <img
          src={row.user.avatar_url}
          alt=""
          className="h-7 w-7 rounded-full object-cover shrink-0"
        />
      ) : (
        <span className="h-7 w-7 rounded-full bg-raised shrink-0" />
      )}
      <span className="truncate font-medium text-ink">{row.user.display_name}</span>
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
      <th className={`px-3 py-2.5 text-2xs font-bold uppercase tracking-wide text-ink-faint ${className}`}>
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
          active ? "text-live" : "text-ink-faint hover:text-ink"
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
