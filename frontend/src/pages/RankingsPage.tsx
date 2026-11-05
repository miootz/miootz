import { useCallback, useEffect, useState } from "react";
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

function SeasonHighlights({ highlights }: { highlights: Record<string, HighlightEntry[]> }) {
  const entries = Object.entries(highlights).filter(([, v]) => v.length > 0);
  if (entries.length === 0) return null;
  return (
    <section className="border border-line bg-panel p-4 space-y-2.5">
      <h2 className="text-lg font-bold text-ink">
        Season highlights
      </h2>
      {entries.map(([key, list]) => (
        <div
          key={key}
          className="grid grid-cols-[110px_1fr] gap-2 items-baseline text-sm"
        >
          <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
            {HIGHLIGHT_LABELS[key] ?? key}
          </span>
          <span className="text-ink-dim">
            {list.map((e, i) => (
              <span key={e.name}>
                {i > 0 && " · "}
                <span className="font-semibold text-ink">{e.name}</span> {e.value}
              </span>
            ))}
          </span>
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
  const [includeOwnGoals, setIncludeOwnGoals] = useState(false);
  const [sort, setSort] = useState<RankingSort>("attendances");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRankings({
        year: yearSel ?? undefined,
        includeOwnGoals,
        sort,
        order,
        page,
        perPage: PER_PAGE,
      });
      setData(res);
      setYearSel((cur) => cur ?? (res.year === null ? "all" : res.year));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rankings");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [yearSel, includeOwnGoals, sort, order, page]);

  useEffect(() => {
    void load();
  }, [load]);

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
    <div className="p-3 sm:p-4 max-w-3xl mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-ink">Rankings</h1>
      </header>

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
          onClick={() => (setYearSel("all"), setPage(1))}
          className={`border px-3 py-2 text-xs font-medium transition-colors ${
            selected === "all"
              ? "border-live bg-live/15 text-live"
              : "border-line text-ink-dim hover:bg-raised hover:text-ink"
          }`}
        >
          All time
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={includeOwnGoals}
          onClick={() => {
            setIncludeOwnGoals((v) => !v);
            setPage(1);
          }}
          className={`ml-auto inline-flex items-center gap-1.5 border px-3 py-2 text-xs font-medium transition-colors ${
            includeOwnGoals
              ? "border-live bg-live/15 text-live"
              : "border-line text-ink-dim hover:bg-raised hover:text-ink"
          }`}
        >
          Include own goals
          <span
            className={`relative inline-flex h-4 w-7 items-center ${
              includeOwnGoals ? "bg-live" : "bg-line"
            }`}
            aria-hidden
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                includeOwnGoals ? "translate-x-3.5" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-live" />
        </div>
      ) : error ? (
        <p className="text-center text-sm text-danger py-8" role="alert">
          {error}
        </p>
      ) : (
        <div className="space-y-3">
          {data?.highlights && (
            <SeasonHighlights highlights={data.highlights} />
          )}
          <RankingsTable
            rows={(data?.rows ?? []) as RankingRow[]}
            sort={sort}
            order={order}
            onSortChange={(s, o) => {
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
