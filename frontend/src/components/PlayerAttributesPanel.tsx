import type { PlayerAttributes } from "../api/meApi";

export function PlayerAttributesPanel({ attributes, error }: {
  attributes?: PlayerAttributes | null;
  error: string | null;
}) {
  const rows = attributes && [
    {
      code: "SHO", name: "Shooting", score: attributes.sho.score,
      evidence: `${attributes.sho.count} open-play goals · ${attributes.sho.sample} eligible matches · ${attributes.sho.meetups} meetups`,
    },
    {
      code: "PAS", name: "Passing", score: attributes.pas.score,
      evidence: `${attributes.pas.count} assists · ${attributes.pas.sample} of ${attributes.pas.total_goals} open-play team goals had a credited assist · ${attributes.pas.meetups} meetups`,
    },
    {
      code: "DEF", name: "Defending", score: attributes.def.score,
      evidence: `${attributes.def.count} clean sheets · ${attributes.def.sample} eligible matches · ${attributes.def.meetups} meetups`,
    },
    { code: "PAC", name: "Pace", score: attributes.pac, evidence: attributes.pac == null ? "Unrated" : "Roster or admin rating" },
    { code: "DRI", name: "Dribbling", score: attributes.dri, evidence: attributes.dri == null ? "Unrated" : "Admin set" },
  ];

  return (
    <section aria-labelledby="player-attributes" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="player-attributes" className="text-lg font-bold text-ink">Player attributes</h2>
        <span className="shrink-0 text-xs text-ink-dim">Current form</span>
      </div>
      <div className="border border-line bg-panel">
        {rows ? (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.code} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center bg-raised text-xs font-bold text-ink-dim">{row.code}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-ink">{row.name} <span className="sr-only">({row.code})</span></h3>
                  <p className="mt-0.5 text-xs leading-5 text-ink-dim">
                    {row.score == null && row.code !== "PAC" && row.code !== "DRI" && "Insufficient data · "}
                    {row.evidence}
                  </p>
                </div>
                <span className={`shrink-0 text-xl font-bold tabular-nums ${row.score == null ? "text-ink-dim" : "text-ink"}`}>
                  {row.score == null ? <span aria-label="Unrated">—</span> : row.score.toFixed(1)}
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
      <details className="text-sm text-ink-dim">
        <summary className="cursor-pointer font-medium text-ink">How attributes are calculated</summary>
        <p className="mt-2">Shooting reflects open-play goals per match, passing reflects assists among open-play team goals with a credited assist, and defending reflects clean sheets per match. Recent meetups count more. Matches with clocked substitutions are excluded, as are incomplete scorecards for shooting and passing.</p>
        <p className="mt-2">Shooting and defending need eight eligible matches across three meetups. Passing needs eight credited goals across three meetups and at least half of open-play team goals to have an assist. Admins can set pace and dribbling. The roster import can supply a starting pace rating.</p>
      </details>
    </section>
  );
}
