import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SessionListItem } from "../api/sessionsApi";
import { fetchSessions, fetchSessionHistorySummary } from "../api/sessionsApi";
import { parseSessionStart } from "../utils/datetime";
import { ChevronRight, Loader2, Search, Users } from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE = 10;

type SortKey = "date-desc" | "date-asc" | "location";

interface MatchSummaryMini {
  matchCount: number;
  final: {
    teamA: string;
    scoreA: number;
    teamB: string;
    scoreB: number;
  } | null;
  ratingAvg: number | null;
}

/* ── Per-session summary (single request) ─────────────── */

function useHistorySummary(sessionId: number): MatchSummaryMini {
  const [summary, setSummary] = useState<MatchSummaryMini>({
    matchCount: 0,
    final: null,
    ratingAvg: null,
  });

  useEffect(() => {
    let cancelled = false;
    void fetchSessionHistorySummary(sessionId)
      .then((res) => {
        if (cancelled) return;
        setSummary({
          matchCount: res.match_count,
          final: res.final
            ? {
                teamA: res.final.team_a_name,
                scoreA: res.final.score_a,
                teamB: res.final.team_b_name,
                scoreB: res.final.score_b,
              }
            : null,
          ratingAvg: res.my_rating_avg,
        });
      })
      .catch(() => {
        if (!cancelled)
          setSummary({ matchCount: 0, final: null, ratingAvg: null });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return summary;
}

/* ── Session row ──────────────────────────────────────── */

function HistorySessionRow({ row }: { row: SessionListItem }) {
  const start = parseSessionStart(row.start_time);
  const { matchCount, final, ratingAvg } = useHistorySummary(row.id);

  return (
    <Link
      to={`/history/${row.id}`}
      className="block rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60"
    >
      <div className="flex items-start gap-3 p-3.5">
        {/* Date chip */}
        <div className="shrink-0 mt-0.5">
          <div className="rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-1.5 text-center min-w-[52px]">
            <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase leading-tight">
              {format(start, "EEE")}
            </div>
            <div className="text-base font-bold text-gray-900 dark:text-gray-100 leading-tight">
              {format(start, "d")}
            </div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
              {format(start, "MMM")}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Attendee count */}
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {row.confirmed_count ?? 0} player
              {row.confirmed_count !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Metadata chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {matchCount > 0 && (
              <span className="rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-400">
                {matchCount} match{matchCount !== 1 ? "es" : ""}
                {final && (
                  <span className="ml-1 text-gray-500 dark:text-gray-400">
                    · Final: {final.teamA} {final.scoreA} – {final.scoreB}{" "}
                    {final.teamB}
                  </span>
                )}
              </span>
            )}
            {ratingAvg != null && (
              <span className="rounded-md bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                ★ {ratingAvg.toFixed(1)}
              </span>
            )}
          </div>
        </div>

        {/* Chevron */}
        <div className="shrink-0 self-center mt-0.5">
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </div>
      </div>
    </Link>
  );
}

/* ── Skeleton row ──────────────────────────────────────── */

function HistoryRowSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3.5 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-[52px] h-14 rounded-lg bg-gray-200 dark:bg-gray-700 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-3/4 max-w-xs rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-3 w-16 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="flex gap-1.5">
            <div className="h-5 w-16 rounded-md bg-gray-200 dark:bg-gray-700" />
            <div className="h-5 w-20 rounded-md bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────── */

export const HistoryPage: React.FC = () => {
  const [pastSessions, setPastSessions] = useState<SessionListItem[]>([]);
  const [pastTotal, setPastTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date-desc");
  const [query, setQuery] = useState("");

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetchSessions({
        status: "past",
        order: "desc",
        limit: PAGE_SIZE,
        offset: 0,
      });
      setPastSessions(r.items);
      setPastTotal(r.total);
    } catch (e) {
      setPastSessions([]);
      setPastTotal(0);
      setLoadError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (loadingMore || pastSessions.length >= pastTotal) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const r = await fetchSessions({
        status: "past",
        order: "desc",
        limit: PAGE_SIZE,
        offset: pastSessions.length,
      });
      setPastSessions((prev) => [...prev, ...r.items]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, pastSessions.length, pastTotal]);

  const sortedFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? pastSessions.filter((s) => s.location.toLowerCase().includes(q))
      : [...pastSessions];
    rows.sort((a, b) => {
      if (sortKey === "location") {
        return a.location.localeCompare(b.location, undefined, {
          sensitivity: "base",
        });
      }
      const ta = parseSessionStart(a.start_time).getTime();
      const tb = parseSessionStart(b.start_time).getTime();
      return sortKey === "date-desc" ? tb - ta : ta - tb;
    });
    return rows;
  }, [pastSessions, query, sortKey]);

  /* ── Sort options ───────────────────────────────────── */

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "date-desc", label: "Newest" },
    { key: "date-asc", label: "Oldest" },
    { key: "location", label: "Location" },
  ];

  /* ── Render ─────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="p-3 sm:p-4 max-w-2xl mx-auto space-y-2">
        <HistoryRowSkeleton />
        <HistoryRowSkeleton />
        <HistoryRowSkeleton />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Match History
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Past meetups — tap a session for results and ratings.
        </p>
      </header>

      {loadError && (
        <p
          className="text-center text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {loadError}
        </p>
      )}

      {/* Search + Sort */}
      {pastSessions.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
            <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by location…"
              className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none dark:text-white"
              aria-label="Filter sessions by location"
            />
          </label>

          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sortOptions.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                  sortKey === key
                    ? "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-200"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-gray-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Session list */}
      {pastSessions.length === 0 && !loadError ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-12">
          No past sessions yet.
        </p>
      ) : sortedFiltered.length === 0 ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-12">
          No sessions match your filter.
        </p>
      ) : (
        <div className="space-y-2">
          {sortedFiltered.map((row) => (
            <HistorySessionRow key={row.id} row={row} />
          ))}

          {pastSessions.length < pastTotal && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="inline-flex items-center gap-2 min-h-[44px] rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                Load more ({pastSessions.length} of {pastTotal})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
