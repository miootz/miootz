import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import {
  fetchAttributeRankings,
  fetchRankings,
  type AttributeRankingsResponse,
  type AttributeSort,
  type HighlightEntry,
  type RankingRow,
  type RankingSort,
  type RankingsResponse,
} from "../api/rankingsApi";
import { AttributeRankingsTable } from "../components/AttributeRankingsTable";
import { RankingsTable } from "../components/RankingsTable";

const PER_PAGE = 25;

const HIGHLIGHT_LABELS: Record<string, string> = {
  goals: "Goals",
  assists: "Assists",
  goal_assists: "Goals + assists",
  goal_assists_per_match: "Goals + assists per match",
  wins: "Wins",
  matches: "Matches played",
  win_rate: "Win rate",
  attendances: "Meetups attended",
};

function SeasonHighlights({
  highlights,
  meId,
  allTime,
}: {
  highlights: Record<string, HighlightEntry[]>;
  meId?: number;
  allTime: boolean;
}) {
  const entries = Object.entries(highlights).filter(([, v]) => v.length > 0);
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="rankings-highlights" className="@container border border-line bg-panel">
      <h2 id="rankings-highlights" className="texture-painted-steel border-b border-line px-4 py-3 text-lg font-bold text-ink">
        {allTime ? "All-time highlights" : "Season highlights"}
      </h2>
      <div className="grid gap-px bg-line @min-[18rem]:grid-cols-2 @min-[45rem]:grid-cols-4">
        {entries.map(([key, list]) => (
          <div key={key} className="flex min-w-0 flex-col bg-panel">
            <h3 className="flex min-h-12 items-end px-3 py-2 text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
              {HIGHLIGHT_LABELS[key] ?? key}
            </h3>
            <ol className="divide-y divide-line border-t border-line">
              {list.map((entry, index) => {
                const leader = index === 0;
                const isMe = entry.user_id === meId;
                const value = key === "goal_assists_per_match" && typeof entry.value === "number"
                  ? entry.value.toFixed(2)
                  : entry.value;
                const scoreSize = String(value).length > 6
                  ? "text-lg @min-[21rem]:text-xl @min-[34rem]:text-2xl"
                  : "text-2xl @min-[21rem]:text-3xl";
                return (
                  <li
                    key={entry.user_id}
                    className={`grid min-w-0 gap-x-2 px-3 ${
                      leader ? "gap-y-1 py-3" : "grid-cols-[minmax(0,1fr)_auto] items-baseline py-2"
                    } ${isMe ? "bg-live/10" : leader ? "bg-raised" : ""}`}
                  >
                    <span className={`text-xs text-ink [overflow-wrap:anywhere] @min-[21rem]:text-sm ${leader ? "order-last font-semibold" : ""}`}>
                      {entry.name}
                      {isMe && (
                        <span className="ml-1.5 whitespace-nowrap text-2xs font-bold text-live">You</span>
                      )}
                    </span>
                    <span
                      className={`tabular-nums [overflow-wrap:anywhere] ${
                        leader
                          ? `text-left font-extrabold leading-none text-ink ${scoreSize}`
                          : "max-w-24 text-right text-xs font-medium text-ink-dim @min-[21rem]:text-sm"
                      }`}
                    >
                      {value}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
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
  const [view, setView] = useState<"stats" | "attributes">("stats");
  const [attributeSort, setAttributeSort] = useState<AttributeSort>("rating");
  const [attributeOrder, setAttributeOrder] = useState<"asc" | "desc">("desc");
  const [attributeData, setAttributeData] = useState<AttributeRankingsResponse | null>(null);
  const [attributeLoading, setAttributeLoading] = useState(false);
  const [attributeError, setAttributeError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const statsPage = view === "stats" ? page : 1;
  const attributeYear = yearSel ?? seasonYear;
  // Restore scroll after a rubric change re-renders the table with a new row
  // order (year/page changes intentionally scroll to the top).
  const restoreScroll = useRef<number | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRankings(
        { year: yearSel ?? undefined, sort, order, page: statsPage, perPage: PER_PAGE },
        signal,
      );
      if (signal.aborted) return;
      setData(res);
      if (yearSel === null) setSeasonYear(res.year);
    } catch (e) {
      if (signal.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to load rankings");
      setData(null);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [yearSel, sort, order, statsPage]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (view !== "attributes" || attributeYear === null) return;
    const controller = new AbortController();
    setAttributeLoading(true);
    setAttributeError(null);
    void fetchAttributeRankings({
      year: attributeYear, sort: attributeSort, order: attributeOrder, page, perPage: PER_PAGE,
    }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setAttributeData(result);
          if (result.computed_scores === false && attributeSort !== "rating") {
            setAttributeSort("rating");
            setPage(1);
          }
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setAttributeData(null);
          setAttributeError(e instanceof Error ? e.message : "Failed to load attributes");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAttributeLoading(false);
      });
    return () => controller.abort();
  }, [view, attributeYear, attributeSort, attributeOrder, page]);

  useEffect(() => {
    if (!loading && restoreScroll.current != null) {
      window.scrollTo({ top: restoreScroll.current });
      restoreScroll.current = null;
    }
  }, [loading]);

  const years = data?.available_years ?? [];
  const selected = attributeYear ?? new Date().getUTCFullYear();
  const prevYear =
    selected === "all"
      ? null
      : [...years].reverse().find((y) => y < selected) ?? null;
  const nextYear =
    selected === "all" ? null : years.find((y) => y > selected) ?? null;

  const total = view === "stats" ? (data?.total ?? 0) : (attributeData?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const busy = loading || (view === "attributes" && (attributeLoading || attributeYear === null));

  return (
    <div className="p-3 sm:p-4 max-w-6xl mx-auto space-y-4">
      <header className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-ink">Rankings</h1>
        {busy && data && (
          <Loader2 className="h-4 w-4 animate-spin text-live motion-reduce:animate-none" aria-hidden />
        )}
      </header>
      <p role="status" className="sr-only">{busy ? "Loading rankings…" : ""}</p>

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
            setYearSel(selected === "all" ? null : "all");
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
        <div className="space-y-3" aria-busy={busy}>
          {data?.highlights && (
            <SeasonHighlights
              highlights={data.highlights}
              meId={me?.user?.id}
              allTime={data.year === null}
            />
          )}
          <div role="group" aria-label="Ranking view" className="grid grid-cols-2 border border-line bg-panel">
            {([ ["stats", "Match stats"], ["attributes", "Ratings"] ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => { setView(key); setPage(1); }}
                className={`min-h-11 border-b-2 px-3 py-2 text-sm font-bold transition-colors ${view === key ? "border-live bg-raised text-live" : "border-transparent text-ink-dim hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "stats" ? (
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
          ) : attributeError ? (
            <p role="alert" className="py-8 text-center text-sm text-danger">{attributeError}</p>
          ) : attributeData ? (
            <>
              <AttributeRankingsTable
                rows={attributeData.rows}
                computedScores={attributeData.computed_scores !== false}
                sort={attributeSort}
                order={attributeOrder}
                onSortChange={(s, o) => { setAttributeSort(s); setAttributeOrder(o); setPage(1); }}
                highlightUserId={me?.user?.id}
              />
              {attributeData.computed_scores !== false && <details className="text-sm text-ink-dim">
                <summary className="cursor-pointer font-medium text-ink">How attributes work</summary>
                <p className="mt-2">Shooting and defending reflect open-play goals and clean sheets per eligible match. Passing reflects assists among open-play team goals with a credited assist. Recent meetups count more, and scores need enough reliable data.</p>
              </details>}
            </>
          ) : (
            <p className="py-8 text-center text-sm text-ink-dim">Loading attributes…</p>
          )}

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
