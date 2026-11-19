import type { UserStats } from "../api/meApi";

const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

interface ProfileScoreboardProps {
  stats: UserStats | null;
  error: string | null;
}

export function ProfileScoreboard({ stats, error }: ProfileScoreboardProps) {
  return (
    <section aria-labelledby="profile-season-stats" className="@container border border-line bg-panel">
      <h2 id="profile-season-stats" className="border-b border-line px-4 py-3 text-lg font-bold text-ink">
        Season stats
      </h2>

      {stats ? (
        <>
          <dl className="grid grid-cols-2 divide-x divide-line bg-raised">
            <ScoreStat label="Goals" value={stats.season_goals} />
            <ScoreStat label="Assists" value={stats.season_assists} />
          </dl>
          <dl className="border-t border-line bg-board px-4">
            <StatRow
              label="Goals + assists per match"
              value={stats.season_matches ? stats.season_goal_assists_per_match.toFixed(2) : "—"}
            />
          </dl>
          <dl className="grid grid-cols-2 gap-px border-y border-line bg-line @min-[21rem]:grid-cols-4">
            <RecordStat label="Matches" value={stats.season_matches} />
            <RecordStat label="Wins" value={stats.season_wins} />
            <RecordStat label="Losses" value={stats.season_losses} />
            <RecordStat label="Win rate" value={stats.season_matches ? percent.format(stats.season_win_rate) : "—"} />
          </dl>
          <dl className="divide-y divide-line px-4">
            <StatRow label="Clean sheets" value={stats.season_clean_sheets} />
            <StatRow
              label="Penalties scored / taken"
              value={`${stats.season_penalties_scored} / ${stats.season_penalties_taken}${stats.season_penalties_taken
                ? ` (${percent.format(stats.season_penalty_conversion_rate)})`
                : ""}`}
            />
          </dl>

          <h3 className="border-y border-line bg-board px-4 py-2.5 text-sm font-semibold text-ink">
            Player record
          </h3>
          <dl className="grid grid-cols-3 gap-px bg-line">
            <RecordStat label="Avg. peer rating" value={stats.total_ratings ? stats.average_rating.toFixed(1) : "—"} />
            <RecordStat label="Season meetups" value={stats.season_games} />
            <RecordStat label="All-time meetups" value={stats.games_played} />
          </dl>
          <dl className="border-t border-line px-4">
            <StatRow label="Weather Hero awards available" value={stats.weather_hero_unused} />
          </dl>
        </>
      ) : error ? (
        <p role="alert" className="px-4 py-3 text-sm text-danger">{error}</p>
      ) : (
        <p role="status" className="px-4 py-3 text-sm text-ink-dim">Loading season stats…</p>
      )}
    </section>
  );
}

function ScoreStat({ label, value }: { label: string; value: number }) {
  const scoreSize = value < 10_000 ? "text-4xl @min-[20rem]:text-5xl" : "text-2xl";
  return (
    <div className="px-4 py-5 text-center">
      <dt className="text-xs font-bold tracking-[0.14em] uppercase text-ink-dim">{label}</dt>
      <dd className={`mt-2 font-extrabold leading-none tabular-nums text-ink [overflow-wrap:anywhere] ${scoreSize}`}>
        {value}
      </dd>
    </div>
  );
}

function RecordStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col-reverse items-start justify-end gap-1 bg-panel px-3 py-2.5">
      <dt className="text-xs text-ink-dim">{label}</dt>
      <dd className="text-lg font-bold leading-none tabular-nums text-ink [overflow-wrap:anywhere] @min-[25rem]:text-xl">{value}</dd>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <dt className="text-sm text-ink-dim">{label}</dt>
      <dd className="shrink-0 font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
