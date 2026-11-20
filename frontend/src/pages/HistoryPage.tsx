import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { MeetupHistorySummary, MeetupListItem } from "../api/meetupsApi";
import { fetchMeetups, fetchMeetupHistorySummary } from "../api/meetupsApi";
import { parseMeetupStart } from "../utils/datetime";
import { ChevronRight, Loader2, Search, Star, Users } from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE = 10;

type SortKey = "date-desc" | "date-asc" | "location";

/* ── Per-meetup summary (single request) ─────────────── */

function useHistorySummary(meetupId: number) {
  const [summary, setSummary] = useState<MeetupHistorySummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchMeetupHistorySummary(meetupId)
      .then((res) => {
        if (cancelled) return;
        setSummary(res);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [meetupId]);

  return summary;
}

/* ── Meetup row ──────────────────────────────────────── */

function HistoryMeetupRow({ row }: { row: MeetupListItem }) {
  const start = parseMeetupStart(row.start_time);
  const summary = useHistorySummary(row.id);
  const matchCount = summary?.match_count ?? 0;
  const winners = summary?.winning_teams ?? [];
  const ratingAvg = summary?.my_rating_avg;

  return (
    <Link
      to={`/history/${row.id}`}
      className="block border border-line bg-panel overflow-hidden transition-colors hover:bg-raised"
    >
      <article className="flex items-start gap-3 p-3.5">
        {/* Date chip */}
        <div className="shrink-0 mt-0.5">
          <div className="bg-raised px-2.5 py-1.5 text-center min-w-[52px]">
            <div className="text-2xs font-medium text-ink-dim uppercase leading-tight">
              {format(start, "EEE")}
            </div>
            <div className="text-base font-bold text-ink leading-tight">
              {format(start, "d")}
            </div>
            <div className="text-2xs text-ink-dim leading-tight">
              {format(start, "MMM")}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Attendee count */}
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-ink-faint shrink-0" />
            <span className="text-sm font-semibold text-ink tabular-nums">
              {row.confirmed_count ?? 0} player
              {row.confirmed_count !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Metadata chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {matchCount > 0 && (
              <span className="bg-raised px-2 py-0.5 text-2xs text-ink-dim">
                {matchCount} match{matchCount !== 1 ? "es" : ""}
                {winners.length > 0 && (
                  <span className="text-ink [overflow-wrap:anywhere]">
                    {" · "}{winners.length === 1 ? "Winner" : "Joint winners"}: {winners.join(", ")}
                  </span>
                )}
              </span>
            )}
            {ratingAvg != null && (
              <span className="inline-flex flex-wrap items-center gap-x-1 bg-live/15 px-2 py-0.5 text-2xs font-medium text-live tabular-nums">
                <Star className="size-3 fill-current" aria-hidden="true" />
                {ratingAvg.toFixed(1)} avg. rating you gave
              </span>
            )}
          </div>
        </div>

        {/* Chevron */}
        <div className="shrink-0 self-center mt-0.5">
          <ChevronRight className="w-4 h-4 text-ink-faint" />
        </div>
      </article>
    </Link>
  );
}

/* ── Skeleton row ──────────────────────────────────────── */

function HistoryRowSkeleton() {
  return (
    <div className="border border-line bg-panel p-3.5 motion-safe:animate-pulse motion-reduce:animate-none">
      <div className="flex items-start gap-3">
        <div className="w-[52px] h-14 bg-raised shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-3/4 max-w-xs bg-raised" />
          <div className="h-3 w-16 bg-raised" />
          <div className="flex gap-1.5">
            <div className="h-5 w-16 bg-raised" />
            <div className="h-5 w-20 bg-raised" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────── */

export const HistoryPage: React.FC = () => {
  const [pastMeetups, setPastMeetups] = useState<MeetupListItem[]>([]);
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
      const r = await fetchMeetups({
        status: "past",
        order: "desc",
        limit: PAGE_SIZE,
        offset: 0,
      });
      setPastMeetups(r.items);
      setPastTotal(r.total);
    } catch (e) {
      setPastMeetups([]);
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
    if (loadingMore || pastMeetups.length >= pastTotal) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const r = await fetchMeetups({
        status: "past",
        order: "desc",
        limit: PAGE_SIZE,
        offset: pastMeetups.length,
      });
      setPastMeetups((prev) => [...prev, ...r.items]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, pastMeetups.length, pastTotal]);

  const sortedFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? pastMeetups.filter((s) => s.location.toLowerCase().includes(q))
      : [...pastMeetups];
    rows.sort((a, b) => {
      if (sortKey === "location") {
        return a.location.localeCompare(b.location, undefined, {
          sensitivity: "base",
        });
      }
      const ta = parseMeetupStart(a.start_time).getTime();
      const tb = parseMeetupStart(b.start_time).getTime();
      return sortKey === "date-desc" ? tb - ta : ta - tb;
    });
    return rows;
  }, [pastMeetups, query, sortKey]);

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
        <h1 className="text-2xl font-bold text-ink">
          Match History
        </h1>
      </header>

      {loadError && (
        <p
          className="text-center text-sm text-danger"
          role="alert"
        >
          {loadError}
        </p>
      )}

      {/* Search + Sort */}
      {pastMeetups.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 border border-line bg-raised px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by location…"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live"
              aria-label="Filter meetups by location"
            />
          </label>

          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sortOptions.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                className={`shrink-0 border px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                  sortKey === key
                    ? "border-live bg-live/15 text-live"
                    : "border-line text-ink-dim hover:bg-raised hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Meetup list */}
      {pastMeetups.length === 0 && !loadError ? (
        <p className="texture-court-marking border border-line px-4 py-12 text-sm text-ink-dim">
          No past meetups yet.
        </p>
      ) : sortedFiltered.length === 0 ? (
        <p className="text-center text-ink-dim py-12">
          No meetups match your filter.
        </p>
      ) : (
        <div className="space-y-2">
          {sortedFiltered.map((row) => (
            <HistoryMeetupRow key={row.id} row={row} />
          ))}

          {pastMeetups.length < pastTotal && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="inline-flex items-center gap-2 min-h-[44px] border border-line px-5 py-2.5 text-sm font-medium text-ink-dim tabular-nums hover:bg-raised hover:text-ink disabled:opacity-50 transition-colors"
              >
                {loadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                Load more ({pastMeetups.length} of {pastTotal})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
