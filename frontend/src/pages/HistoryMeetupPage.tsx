import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Trophy } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "../auth/useAuth";
import { fetchMeetupDetail, type MeetupDetail } from "../api/meetupsApi";
import {
  fetchMeetupRankings,
  type NightStats,
  type RankingRow,
  type RankingSort,
  type TeamNightRecord,
} from "../api/rankingsApi";
import { MeetupDetailPanel } from "../components/MeetupDetailPanel";
import { RankingsTable } from "../components/RankingsTable";
import { PlayerEditLink } from "../components/PlayerEditLink";
import { parseMeetupStart } from "../utils/datetime";

function KpiTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-line bg-panel px-3 py-2.5 text-center">
      <p className="text-xl font-bold text-ink tabular-nums">{value}</p>
      <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
        {label}
      </p>
    </div>
  );
}

function MeetupWinnerCard({ teams }: { teams: TeamNightRecord[] }) {
  return (
    <article className="@container mt-3 border border-line bg-panel">
      <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-semibold text-ink-dim">
        <Trophy className="size-4 shrink-0" aria-hidden="true" />
        {teams.length === 1 ? "Meetup winner" : "Joint meetup winners"}
      </h3>
      <div className="divide-y divide-line">
        {teams.map((team, index) => (
          <div key={team.name}>
            <div className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 ${index === 0 ? "texture-football-seam" : ""}`}>
              <h4 className="min-w-0 text-xl leading-tight font-bold text-ink [overflow-wrap:anywhere]">
                {team.name}
              </h4>
              <span className="text-xs text-ink-dim tabular-nums">
                {team.matches} {team.matches === 1 ? "match" : "matches"} played
              </span>
            </div>
            <dl className="mx-4 mt-2 mb-4 grid grid-cols-2 gap-px border border-line bg-line @min-[22rem]:grid-cols-4">
              {([
                ["Wins", team.wins],
                ["Goals", team.goals_for],
                ["Assists", team.assists],
                ["Clean sheets", team.clean_sheets],
              ] as const).map(([label, value]) => (
                <div key={label} className="min-w-0 bg-raised px-3 py-2">
                  <dt className="text-xs text-ink-dim">{label}</dt>
                  <dd className="text-xl font-bold text-ink tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </article>
  );
}

export function HistoryMeetupPage() {
  const { me } = useAuth();
  const { meetupId } = useParams<{ meetupId: string }>();
  const navigate = useNavigate();
  const id = Number(meetupId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MeetupDetail | null>(null);

  // Per-meetup top performers (hidden when the meetup has no completed matches).
  const [performers, setPerformers] = useState<RankingRow[] | null>(null);
  const [night, setNight] = useState<NightStats | null>(null);
  const [pSort, setPSort] = useState<RankingSort>("goals");
  const [pOrder, setPOrder] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchMeetupDetail(id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load meetup");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Best-effort: a 404 (no completed matches) hides the section entirely.
  useEffect(() => {
    let cancelled = false;
    void fetchMeetupRankings(id)
      .then((res) => {
        if (cancelled) return;
        setPerformers(res.rows);
        setNight(res.night);
      })
      .catch(() => {
        if (cancelled) return;
        setPerformers(null);
        setNight(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const sortedPerformers = useMemo(() => {
    if (!performers) return null;
    const rows = [...performers];
    rows.sort((a, b) => {
      const d = a[pSort] - b[pSort];
      if (d !== 0) return pOrder === "desc" ? -d : d;
      return (b.rating ?? -1) - (a.rating ?? -1)
        || a.user.display_name.localeCompare(b.user.display_name)
        || a.user.id - b.user.id;
    });
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [performers, pSort, pOrder]);

  /* ── Loading ──────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-live" />
      </div>
    );
  }

  /* ── Error / not found ────────────────────────────── */

  if (error || !detail) {
    return (
      <div className="p-4 max-w-2xl mx-auto text-center space-y-4">
        <p className="text-danger">
          {error || "Meetup not found"}
        </p>
        <button
          type="button"
          onClick={() => navigate("/history")}
          className="inline-flex items-center gap-1.5 min-h-[44px] border border-line px-5 py-2.5 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to History
        </button>
      </div>
    );
  }

  /* ── Detail ───────────────────────────────────────── */

  const start = parseMeetupStart(detail.start_time);
  const dateLabel = format(start, "EEEE, d MMMM yyyy");
  const timeLabel = format(start, "HH:mm");
  const winners = night?.teams.filter((team) => night.winning_teams?.includes(team.name)) ?? [];

  return (
    <div className="p-3 sm:p-4 max-w-2xl mx-auto space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={() => navigate("/history")}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-dim hover:text-ink transition-colors min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to History
      </button>

      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold text-ink">
          {dateLabel}
        </h1>
        <p className="text-sm text-ink-dim mt-0.5">
          {detail.location}
          {(detail.fee_text != null ||
            (detail.fee != null && detail.fee > 0)) && (
            <span className="tabular-nums">
              {' '}
              · {detail.fee_text ?? `$${(detail.fee as number).toFixed(0)}`}
            </span>
          )}
        </p>
      </header>

      {/* Night KPIs (hidden without completed matches) */}
      {night && (
        <section>
          <h2 className="text-lg font-bold text-ink mb-2">The night</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiTile label="Matches" value={night.kpis.matches} />
            <KpiTile label="Goals" value={night.kpis.goals} />
            <KpiTile label="Players" value={night.kpis.players} />
            <KpiTile label="Draws" value={night.kpis.draws} />
          </div>
          {winners.length > 0 && <MeetupWinnerCard teams={winners} />}
        </section>
      )}

      {performers && night && (
        <section className="space-y-3" aria-labelledby="player-contributions">
          <div>
            <h2 id="player-contributions" className="text-lg font-bold text-ink">Player contributions</h2>
            <p className="text-sm text-ink-dim">This meetup</p>
          </div>
          <div className="border border-line bg-panel">
            <ul className="divide-y divide-line" aria-label="Goals, assists and clean sheets for this meetup">
              {performers.map((player) => (
                <li key={player.user.id} className={`relative px-3 py-3 ${player.user.id === me?.user?.id ? "bg-live/10" : ""}`}>
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 text-left font-medium text-ink [overflow-wrap:anywhere]">
                      <PlayerEditLink playerId={player.user.id} stretch>{player.user.display_name}</PlayerEditLink>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-sm">
                      <span className="flex flex-col items-center text-xs text-ink-dim">
                        <span className="font-bold text-ink tabular-nums">{player.goals - player.own_goals}</span>
                        <abbr title="Goals">G</abbr>
                      </span>
                      <span className="flex flex-col items-center text-xs text-ink-dim">
                        <span className="font-bold text-ink tabular-nums">{player.assists}</span>
                        <abbr title="Assists">A</abbr>
                      </span>
                      <span className="flex flex-col items-center text-xs text-ink-dim">
                        <span className="font-bold text-ink tabular-nums">{player.clean_sheets}</span>
                        <abbr title="Clean sheets">CS</abbr>
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-ink-dim">Goals exclude own goals.</p>
        </section>
      )}

      {/* Detail panel (starting teams get the night stats merged in) */}
      <MeetupDetailPanel
        meetupId={id}
        meetupLocation={detail.location}
        meetupTime={timeLabel}
        meetupFee={detail.fee}
        meetupFeeText={detail.fee_text}
        teamStats={night?.teams}
        currentUserId={me?.user?.id}
      />

      {/* Top performers for this meetup (hidden without completed matches) */}
      {sortedPerformers && sortedPerformers.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-bold text-ink">Top performers</h2>
          <RankingsTable
            rows={sortedPerformers}
            sort={pSort}
            order={pOrder}
            onSortChange={(s, o) => {
              setPSort(s);
              setPOrder(o);
            }}
            highlightUserId={me?.user?.id}
            excludeColumns={["attendances"]}
            emptyLabel="No ranked players for this meetup."
          />
        </section>
      )}
    </div>
  );
}
