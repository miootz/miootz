import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import {
  fetchRankings,
  type HighlightEntry,
  type RankingRow,
  type RankingSort,
  type RankingsResponse,
} from "../api/rankingsApi";
import { RankingsTable } from "../components/RankingsTable";

const PER_PAGE = 25;

const HIGHLIGHT_LABELS: Record<string, string> = {
  goals: "Goals",
  assists: "Assists",
  goal_assists: "Goals + assists",
  wins: "Most wins",
  matches: "Most matches",
  win_rate: "Win rate",
  attendances: "Most meetups",
};

function SeasonHighlights({
  highlights,
  meId,
}: {
  highlights: Record<string, HighlightEntry[]>;
  meId?: number;
}) {
  const entries = Object.entries(highlights).filter(([, v]) => v.length > 0);
  if (entries.length === 0) return null;
  return (
    <section className="border border-line bg-panel p-4 space-y-2.5">
      <h2 className="text-lg font-bold text-ink">
        Season highlights
      </h2>
      {entries.map(([key, list]) => (
        <div key={key} className="space-y-1">
          <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
            {HIGHLIGHT_LABELS[key] ?? key}
          </span>
          <ul className="space-y-0.5">
            {list.map((e) => (
              <li
                key={e.user_id}
                className={`flex items-baseline justify-between gap-2 text-sm ${
                  e.user_id === meId ? "bg-live/10" : ""
                }`}
              >
                <span className="font-semibold text-ink">
                  {e.name}
                  {e.user_id === meId && (
                    <span className="text-2xs font-bold text-live ml-1.5">You</span>
                  )}
                </span>
                <span className="text-ink-dim tabular-nums">{e.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

type YearSel = number | "all";

export function RankingsPage() {
  const { me } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RankingsResponse | null>(null);

  const [yearSel, setYearSel] = useState<YearSel | null>(null); // null → server default (current season)
  const [seasonYear, setSeasonYear] = useState<number | null>(null); // server's current season, stable
  const [sort, setSort] = useState<RankingSort>("attendances");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  // Restore scroll after a rubric change re-renders the table with a new row
  // order (year/page changes intentionally scroll to the top).
  const restoreScroll = useRef<number | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRankings(
        { year: yearSel ?? undefined, sort, order, page, perPage: PER_PAGE },
        signal,
      );
      if (signal.aborted) return;
      setData(res);
      setYearSel((cur) => cur ?? (res.year === null ? "all" : res.year));
      setSeasonYear((cur) => cur ?? (res.year === null ? null : res.year));
    } catch (e) {
      if (signal.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to load rankings");
      setData(null);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [yearSel, sort, order, page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!loading && restoreScroll.current != null) {
      window.scrollTo({ top: restoreScroll.current });
      restoreScroll.current = null;
    }
  }, [loading]);

  const years = data?.available_years ?? [];
  const selected = yearSel === null ? (data?.year ?? new Date().getFullYear()) : yearSel;
  const prevYear =
    selected === "all"
      ? null
      : [...years].reverse().find((y) => y < selected) ?? null;
  const nextYear =
    selected === "all" ? null : years.find((y) => y > selected) ?? null;

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="p-3 sm:p-4 max-w-6xl mx-auto space-y-4">
      <header className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-ink">Rankings</h1>
        {loading && data && (
          <Loader2 className="h-4 w-4 animate-spin text-live motion-reduce:animate-none" aria-hidden />
        )}
      </header>
      <p role="status" className="sr-only">{loading ? "Loading rankings…" : ""}</p>

      {/* Season navigation */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center border border-line bg-panel">
          <button
            type="button"
            onClick={() => prevYear && (setYearSel(prevYear), setPage(1))}
            disabled={!prevYear}
            aria-label="Previous season"
            className="inline-flex h-11 w-10 items-center justify-center text-ink-dim hover:text-ink disabled:opacity-30 focus:outline-hidden focus:ring-2 focus:ring-live"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="px-2 min-w-[64px] text-center text-sm font-bold text-ink tabular-nums">
            {selected === "all" ? "All time" : selected}
          </span>
          <button
            type="button"
            onClick={() => nextYear && (setYearSel(nextYear), setPage(1))}
            disabled={!nextYear}
            aria-label="Next season"
            className="inline-flex h-11 w-10 items-center justify-center text-ink-dim hover:text-ink disabled:opacity-30 focus:outline-hidden focus:ring-2 focus:ring-live"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          aria-pressed={selected === "all"}
          // Toggling off returns to the current season.
          onClick={() => {
            setYearSel(selected === "all" ? (seasonYear ?? new Date().getFullYear()) : "all");
            setPage(1);
          }}
          className={`border px-3 py-2 text-xs font-medium transition-colors ${
            selected === "all"
              ? "border-live bg-live/15 text-live"
              : "border-line text-ink-dim hover:bg-raised hover:text-ink"
          }`}
        >
          All time
        </button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-live motion-reduce:animate-none" aria-hidden />
        </div>
      ) : error ? (
        <p className="text-center text-sm text-danger py-8" role="alert">
          {error}
        </p>
      ) : (
        <div className="space-y-3" aria-busy={loading}>
          {data?.highlights && (
            <SeasonHighlights highlights={data.highlights} meId={me?.user?.id} />
          )}
          <RankingsTable
            rows={(data?.rows ?? []) as RankingRow[]}
            sort={sort}
            order={order}
            onSortChange={(s, o) => {
              restoreScroll.current = window.scrollY;
              setSort(s);
              setOrder(o);
              setPage(1);
            }}
            highlightUserId={me?.user?.id}
          />

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 min-h-[44px] border border-line px-4 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden /> Prev
              </button>
              <span className="text-xs text-ink-dim tabular-nums">
                Page {page} of {pages} · {total} players
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="inline-flex items-center gap-1 min-h-[44px] border border-line px-4 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-40 transition-colors"
              >
                Next <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
