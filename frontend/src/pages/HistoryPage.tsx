import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionListItem } from '../api/sessionsApi';
import { fetchSessions } from '../api/sessionsApi';
import { fetchRatingContext } from '../api/ratingsApi';
import { SessionRatingsPanel } from '../components/SessionRatingsPanel';
import { parseSessionStart } from '../utils/datetime';
import { ArrowDownAZ, CalendarClock, Loader2, Search } from 'lucide-react';

const PAGE_SIZE = 10;

type SortKey = 'date-desc' | 'date-asc' | 'location';

function useMyRatingsAverage(sessionId: number) {
  const [avg, setAvg] = useState<number | null | 'loading'>('loading');

  useEffect(() => {
    let cancelled = false;
    void fetchRatingContext(sessionId)
      .then((ctx) => {
        const scores = ctx.ratees
          .map((r) => r.my_score)
          .filter((s): s is number => s != null && s > 0);
        if (cancelled) return;
        if (scores.length === 0) setAvg(null);
        else setAvg(scores.reduce((a, b) => a + b, 0) / scores.length);
      })
      .catch(() => {
        if (!cancelled) setAvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return avg;
}

function HistorySessionRow({
  row,
  expanded,
  onToggle,
}: {
  row: SessionListItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const day =
    row.start_time.length >= 10
      ? row.start_time.slice(0, 10)
      : parseSessionStart(row.start_time).toISOString().slice(0, 10);

  const ratingAvg = useMyRatingsAverage(row.id);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.changedTouches[0]?.clientX ?? null);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStart == null) return;
    const end = e.changedTouches[0]?.clientX ?? touchStart;
    if (end - touchStart > 70 && !expanded) onToggle();
    setTouchStart(null);
  };

  return (
    <div
      className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900 transition-colors"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex flex-wrap justify-between items-start gap-2 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="min-w-0 space-y-1">
          <div className="font-bold text-lg text-gray-900 dark:text-white">{day}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">{row.location}</div>
          <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-500">
            {row.fee > 0 && <span>Fee ${row.fee.toFixed(0)}</span>}
            <span>
              Players {row.min_players}–{row.max_players}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {ratingAvg === 'loading' && (
            <span className="text-xs text-gray-400">…</span>
          )}
          {ratingAvg !== 'loading' && ratingAvg != null && (
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              ★ {ratingAvg.toFixed(1)}
            </span>
          )}
          <span className="text-purple-600 dark:text-purple-400 font-medium text-sm">
            {expanded ? 'Collapse' : 'Details & ratings'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="p-4 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 space-y-6">
          <p className="text-xs text-gray-500 dark:text-gray-400 md:hidden">
            Tip: swipe right on a session row to expand.
          </p>
          <section>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Player ratings
            </h3>
            <SessionRatingsPanel sessionId={row.id} />
          </section>
        </div>
      )}
    </div>
  );
}

export const HistoryPage: React.FC = () => {
  const [pastSessions, setPastSessions] = useState<SessionListItem[]>([]);
  const [pastTotal, setPastTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('date-desc');
  const [query, setQuery] = useState('');

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetchSessions({
        status: 'past',
        order: 'desc',
        limit: PAGE_SIZE,
        offset: 0,
      });
      setPastSessions(r.items);
      setPastTotal(r.total);
    } catch (e) {
      setPastSessions([]);
      setPastTotal(0);
      setLoadError(e instanceof Error ? e.message : 'Failed to load history');
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
        status: 'past',
        order: 'desc',
        limit: PAGE_SIZE,
        offset: pastSessions.length,
      });
      setPastSessions((prev) => [...prev, ...r.items]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load more');
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
      if (sortKey === 'location') {
        return a.location.localeCompare(b.location, undefined, {
          sensitivity: 'base',
        });
      }
      const ta = parseSessionStart(a.start_time).getTime();
      const tb = parseSessionStart(b.start_time).getTime();
      return sortKey === 'date-desc' ? tb - ta : ta - tb;
    });
    return rows;
  }, [pastSessions, query, sortKey]);

  const toggle = useCallback((idStr: string) => {
    setExpandedSession((prev) => (prev === idStr ? null : idStr));
  }, []);

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Match History</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Past meetups for everyone. Only attendees can rate teammates (anonymous).
        </p>
      </header>

      {loadError && (
        <p className="text-center text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}

      {pastSessions.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSortKey('date-desc')}
              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                sortKey === 'date-desc'
                  ? 'border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Newest
            </button>
            <button
              type="button"
              onClick={() => setSortKey('date-asc')}
              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                sortKey === 'date-asc'
                  ? 'border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              Oldest
            </button>
            <button
              type="button"
              onClick={() => setSortKey('location')}
              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                sortKey === 'location'
                  ? 'border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <ArrowDownAZ className="h-3.5 w-3.5" aria-hidden />
              Location
            </button>
          </div>
        </div>
      )}

      {pastSessions.length === 0 && !loadError ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-8">
          No past sessions yet.
        </p>
      ) : sortedFiltered.length === 0 ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-8">
          No sessions match your filter.
        </p>
      ) : (
        <div className="space-y-4">
          {sortedFiltered.map((row) => {
            const idStr = String(row.id);
            return (
              <HistorySessionRow
                key={row.id}
                row={row}
                expanded={expandedSession === idStr}
                onToggle={() => toggle(idStr)}
              />
            );
          })}
          {pastSessions.length < pastTotal && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 dark:border-gray-600 px-5 py-2.5 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
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
