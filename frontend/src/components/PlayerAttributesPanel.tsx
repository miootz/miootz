import type { PlayerAttributes } from "../api/meApi";
import { ATTRIBUTE_COLOR, toAttributeScale } from "../utils/attributeScale";

function countLabel(count: number, noun: string, plural = `${noun}s`) {
  return `${count} ${count === 1 ? noun : plural}`;
}

export function PlayerAttributesPanel({ attributes, error }: {
  attributes?: PlayerAttributes | null;
  error: string | null;
}) {
  const rows = attributes && [
    {
      code: "sho" as const, name: "Shooting", score: attributes.sho.score,
      evidence: !attributes.sho.overridden && [
        countLabel(attributes.sho.count, "goal"),
        countLabel(attributes.sho.sample, "match", "matches"),
        countLabel(attributes.sho.meetups, "meetup"),
      ].join(" - "),
    },
    {
      code: "pas" as const, name: "Passing", score: attributes.pas.score,
      evidence: !attributes.pas.overridden && [
        countLabel(attributes.pas.count, "assist"),
        countLabel(attributes.pas.meetups, "meetup"),
      ].join(" - "),
    },
    {
      code: "def" as const, name: "Defending", score: attributes.def.score,
      evidence: !attributes.def.overridden && [
        countLabel(attributes.def.count, "clean sheet"),
        countLabel(attributes.def.sample, "match", "matches"),
        countLabel(attributes.def.meetups, "meetup"),
      ].join(" - "),
    },
    { code: "pac" as const, name: "Pace", score: attributes.pac },
    { code: "dri" as const, name: "Dribbling", score: attributes.dri },
  ];

  return (
    <section aria-labelledby="player-attributes" className="space-y-3">
      <h2 id="player-attributes" className="text-lg font-bold text-ink">Player attributes</h2>
      <div className="border border-line bg-panel">
        {rows ? (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.code} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center bg-raised text-xs font-bold uppercase ${ATTRIBUTE_COLOR[row.code]}`}>{row.code.toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <h3 className={`font-bold ${ATTRIBUTE_COLOR[row.code]}`}>{row.name} <span className="sr-only">({row.code.toUpperCase()})</span></h3>
                  {row.evidence && <p className="mt-0.5 text-xs leading-5 text-ink-dim">{row.evidence}</p>}
                </div>
                <span className={`shrink-0 text-xl font-bold tabular-nums ${row.score == null ? "text-ink-dim" : ATTRIBUTE_COLOR[row.code]}`}>
                  {row.score == null ? <span aria-label="Unrated">—</span> : toAttributeScale(row.score)}
                </span>
              </li>
            ))}
          </ul>
        ) : error ? (
          <p role="alert" className="px-4 py-3 text-sm text-danger">{error}</p>
        ) : (
          <p role="status" className="px-4 py-3 text-sm text-ink-dim">Loading attributes…</p>
        )}
      </div>
    </section>
  );
}
