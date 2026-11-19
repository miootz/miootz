import { ArrowDown, ArrowUp } from "lucide-react";
import type { AttributeRankingRow, AttributeSort } from "../api/rankingsApi";
import { ATTRIBUTE_COLOR, toAttributeScale } from "../utils/attributeScale";
import { PlayerEditLink } from "./PlayerEditLink";
import { SkillRating } from "./SkillRating";

const ATTRIBUTES: { key: AttributeSort; label: string }[] = [
  { key: "sho", label: "Shooting" },
  { key: "pas", label: "Passing" },
  { key: "def", label: "Defending" },
];

export function AttributeRankingsTable({
  rows, sort, order, onSortChange, highlightUserId, computedScores,
}: {
  rows: AttributeRankingRow[];
  sort: AttributeSort;
  order: "asc" | "desc";
  onSortChange: (sort: AttributeSort, order: "asc" | "desc") => void;
  highlightUserId?: number;
  computedScores: boolean;
}) {
  const columns: { key: AttributeSort; label: string; heading: string }[] = [
    { key: "rating", label: computedScores ? "Adjusted Rating" : "Base Rating", heading: "Rating" },
    ...(computedScores ? ATTRIBUTES.map((attribute) => ({
      ...attribute,
      heading: attribute.key.toUpperCase(),
    })) : []),
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink-dim">{computedScores ? "Adjusted Rating" : "Base Rating"} · current</p>
      <div className="border border-line bg-panel">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Player attribute rankings</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={`${computedScores ? "w-[38%]" : "w-[65%]"} px-2 py-3 text-left text-xs font-bold text-ink-dim sm:px-3`}>Player</th>
              {columns.map(({ key, label, heading }) => (
                <th
                  key={key}
                  scope="col"
                  aria-sort={sort === key ? (order === "desc" ? "descending" : "ascending") : undefined}
                  className={`text-right ${computedScores && key === "rating" ? "w-[18%] sm:w-auto" : ""}`}
                >
                  <button
                    type="button"
                    aria-label={`Sort by ${label}`}
                    onClick={() => onSortChange(key, sort === key && order === "desc" ? "asc" : "desc")}
                    className={`inline-flex min-h-11 w-full items-center justify-end gap-0.5 px-0.5 text-xs font-bold hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-live sm:px-3 ${key === "rating" ? "text-ink-dim" : ATTRIBUTE_COLOR[key]}`}
                  >
                    {heading}
                    {sort === key && (order === "desc" ? <ArrowDown className="size-2.5 shrink-0 text-live sm:size-3" aria-hidden /> : <ArrowUp className="size-2.5 shrink-0 text-live sm:size-3" aria-hidden />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.user.id} className={`relative ${row.user.id === highlightUserId ? "bg-live/10" : ""}`}>
                <th scope="row" className="px-2 py-3 text-left font-medium text-ink sm:px-3">
                  <span className="mr-2 text-xs text-ink-dim tabular-nums">{row.rank ?? "—"}</span>
                  <PlayerEditLink playerId={row.user.id} className="[overflow-wrap:anywhere]" stretch>{row.user.display_name}</PlayerEditLink>
                  {row.user.id === highlightUserId && <span className="ml-1 text-xs text-live">You</span>}
                </th>
                {columns.map(({ key }) => {
                  const value = row[key];
                  return (
                    <td key={key} className="px-1 py-3 text-right font-bold tabular-nums sm:px-3">
                      {value == null ? <span className="text-ink-dim" aria-label="Insufficient data">—</span> : (
                        key === "rating" ? <SkillRating score={value} /> : (
                          <span className={ATTRIBUTE_COLOR[key]}>{toAttributeScale(value)}</span>
                        )
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-dim">No players in this scope.</p>}
      </div>
      <p className="text-xs text-ink-dim">— Insufficient data</p>
    </div>
  );
}
