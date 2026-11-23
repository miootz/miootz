import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { fetchPlayerProgress, type PlayerProgress, type PlayerProgressPoint } from "../api/meApi";

const VIEWS = ["Rating", "Attack", "Results"] as const;
type View = typeof VIEWS[number];

const SERIES = {
  Attack: [
    { key: "goals", label: "Goals", color: "var(--color-attribute-sho)" },
    { key: "assists", label: "Recorded assists", color: "var(--color-attribute-pas)" },
  ],
  Results: [
    { key: "wins", label: "Wins", color: "var(--color-ink)" },
    { key: "clean_sheets", label: "Clean sheets", color: "var(--color-attribute-def)" },
  ],
  Rating: [
    { key: "base_rating", label: "Base Rating", color: "var(--color-ink-dim)" },
    { key: "adjusted_rating", label: "Adjusted Rating", color: "var(--color-ink)" },
  ],
} as const;

function ProgressChart({ points, view, computed }: {
  points: PlayerProgressPoint[];
  view: View;
  computed: boolean;
}) {
  const series = view === "Rating" && !computed ? SERIES.Rating.slice(0, 1) : SERIES[view];
  const isRating = view === "Rating";
  const width = Math.max(330, points.length * 43 + 28);
  const floor = isRating ? 1 : 0;
  const max = isRating ? 5 : Math.max(4, ...points.map((point) =>
    view === "Results" ? point.matches : Math.max(point.goals, point.assists),
  ));
  const left = 27;
  const top = 12;
  const bottom = 142;
  const step = (width - left - 8) / points.length;
  const x = (index: number) => left + step * (index + 0.5);
  const y = (value: number) => bottom - (value - floor) / (max - floor) * (bottom - top);
  const ticks = isRating ? [1, 2, 3, 4, 5] : [...new Set([0, Math.round(max / 2), max])];
  const labelEvery = points.length <= 8 ? 1 : 2;

  if (isRating && points.every((point) => series.every(({ key }) => point[key] === null))) {
    return <p className="text-sm text-ink-dim">Rating history starts when a meetup’s review window closes.</p>;
  }

  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-dim">
        {series.map(({ key, label, color }, index) => (
          <span className="inline-flex items-center gap-2" key={key}>
            <span
              aria-hidden="true"
              className={`w-4 border-t-2 ${isRating && index === 0 ? "border-dashed" : ""}`}
              style={{ borderColor: color }}
            />
            {label}
          </span>
        ))}
        {view === "Results" && (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="w-4 border-t-2 border-ink-faint" />
            Matches played
          </span>
        )}
      </figcaption>
      <div
        className="overflow-x-auto"
        tabIndex={points.length > 8 ? 0 : undefined}
        role={points.length > 8 ? "region" : undefined}
        aria-label={points.length > 8 ? `${view} chart` : undefined}
      >
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${width} 171`}
          className="block w-full max-h-52"
          style={{ minWidth: points.length > 8 ? width : undefined }}
        >
          {ticks.map((value) => (
            <g key={value}>
              <line x1={left} x2={width - 8} y1={y(value)} y2={y(value)} stroke="var(--color-line)" />
              <text x={left - 7} y={y(value)} dy=".35em" textAnchor="end" fontSize="11" fill="var(--color-ink-dim)">{value}</text>
            </g>
          ))}
          {points.map((point, index) => (
            <g key={point.meetup_id}>
              {index % labelEvery === 0 && (
                <text x={x(index)} y="161" textAnchor="middle" fontSize="10" fill="var(--color-ink-dim)">
                  {format(new Date(point.start_time), "d MMM")}
                </text>
              )}
              {series.map(({ key, color }, seriesIndex) => {
                const value = point[key];
                if (value === null) return null;
                if (isRating) {
                  const previous = points[index - 1]?.[key];
                  return (
                    <g key={key}>
                      {previous != null && (
                        <line
                          x1={x(index - 1)} y1={y(previous)} x2={x(index)} y2={y(value)}
                          stroke={color} strokeWidth="2" strokeDasharray={seriesIndex === 0 ? "4 3" : undefined}
                        />
                      )}
                      <circle cx={x(index)} cy={y(value)} r={seriesIndex === 0 ? 2.5 : 3} fill={color} />
                    </g>
                  );
                }
                const barWidth = Math.min(15, step / 3);
                const barX = x(index) + (seriesIndex === 0 ? -barWidth - 1 : 1);
                return (
                  <g key={key}>
                    {view === "Results" && (
                      <rect x={barX} y={y(point.matches)} width={barWidth} height={bottom - y(point.matches)} fill="none" stroke="var(--color-ink-faint)" />
                    )}
                    <rect x={barX} y={y(value)} width={barWidth} height={bottom - y(value)} fill={color} />
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      <details className="border-t border-line">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-ink-dim">
          View meetup values
        </summary>
        <table className="w-full text-left text-xs tabular-nums">
          <caption className="sr-only">{view} by meetup</caption>
          <thead className="text-ink-dim">
            <tr>
              <th scope="col" className="py-2 pe-2">Meetup</th>
              {series.map(({ key, label }) => <th key={key} scope="col" className="py-2 pe-2">{label}</th>)}
              {!isRating && <th scope="col" className="py-2">Matches</th>}
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((point) => (
              <tr key={point.meetup_id} className="border-t border-line">
                <th scope="row" className="pe-2 font-medium">
                  <Link to={`/history/${point.meetup_id}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                    {format(new Date(point.start_time), "d MMM yyyy")}
                  </Link>
                </th>
                {series.map(({ key }) => (
                  <td className="pe-2" key={key}>
                    {isRating ? point[key]?.toFixed(1) ?? "—" : point[key]}
                  </td>
                ))}
                {!isRating && <td>{point.matches}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function ProfileProgress() {
  const [view, setView] = useState<View>(VIEWS[0]);
  const [season, setSeason] = useState(false);
  const [result, setResult] = useState<{ season: boolean; data?: PlayerProgress; error?: string } | null>(null);
  const year = new Date().getUTCFullYear();

  useEffect(() => {
    const controller = new AbortController();
    void fetchPlayerProgress(season ? year : undefined, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResult({ season, data }); },
      () => { if (!controller.signal.aborted) setResult({ season, error: "Could not load progress." }); },
    );
    return () => controller.abort();
  }, [season, year]);

  const current = result?.season === season ? result : null;

  return (
    <section className="space-y-4 border border-line bg-panel p-4 sm:p-5" aria-labelledby="profile-progress">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="profile-progress" className="text-lg font-bold">Progress</h2>
        <select
          aria-label="Progress range"
          value={season ? "season" : "recent"}
          onChange={(event) => setSeason(event.target.value === "season")}
          className="min-h-11 border border-line bg-raised px-2 text-sm text-ink"
        >
          <option value="recent">Last 8 played meetups</option>
          <option value="season">{year} season</option>
        </select>
      </header>
      <div aria-label="Progress metric" role="group" className="grid grid-cols-3 border-b border-line">
        {VIEWS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={view === item}
            className="min-h-11 border-b-2 border-transparent px-2 text-sm font-bold text-ink-dim hover:text-ink aria-pressed:border-live aria-pressed:text-live"
            onClick={() => setView(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {current?.data?.meetups.length ? (
        <ProgressChart key={view} points={current.data.meetups} view={view} computed={current.data.computed_scores} />
      ) : (
        <p className="text-sm text-ink-dim" role="status">
          {current?.error ?? (current?.data ? "No played meetups in this range." : "Loading progress…")}
        </p>
      )}
    </section>
  );
}
