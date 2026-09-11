import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import {
  Calendar,
  Loader2,
  MapPin,
  Plus,
  Repeat,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { fetchSessions, type SessionListItem } from "../../api/sessionsApi";
import { parseSessionStart } from "../../utils/datetime";
import { adminDeleteSession } from "../../api/adminApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";
import { useToast } from "../../context/ToastContext";
import { hapticLight } from "../../utils/haptics";

const PAGE_SIZE = 50;

type SessionFilter = "all" | "upcoming" | "past" | "weekly" | "next7";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/* ── Skeleton ─────────────────────────────────────────── */

function SessionRowSkeleton() {
  return (
    <li className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="h-4 w-4 rounded-full bg-gray-200 dark:bg-gray-700 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-12 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
          <div className="h-4 w-3/4 max-w-xs rounded bg-gray-200 dark:bg-gray-700" />
          <div className="flex gap-2">
            <div className="h-5 w-20 rounded-md bg-gray-200 dark:bg-gray-700" />
            <div className="h-5 w-16 rounded-md bg-gray-200 dark:bg-gray-700" />
          </div>
          <div className="h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    </li>
  );
}

/* ── Compact progress bar ─────────────────────────────── */

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const colour =
    pct >= 90 ? "bg-emerald-500" : pct >= 60 ? "bg-sky-500" : "bg-amber-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${colour} transition-[width]`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-2xs tabular-nums text-gray-500 dark:text-gray-400 shrink-0 leading-none">
        {value}/{max}
      </span>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────── */

export function AdminSessionsPage() {
  const { showToast } = useToast();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 300);
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState(25);

  const reloadFirstPage = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchSessions({
        limit: PAGE_SIZE,
        offset: 0,
        q: debouncedQuery.trim() || undefined,
      });
      const list = res.items;
      setSessions(
        [...list].sort(
          (a, b) =>
            parseSessionStart(a.start_time).getTime() -
            parseSessionStart(b.start_time).getTime(),
        ),
      );
      setHasMore(res.offset + res.items.length < res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery]);

  useEffect(() => {
    setLoading(true);
    void reloadFirstPage();
  }, [reloadFirstPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await fetchSessions({
        limit: PAGE_SIZE,
        offset: sessions.length,
        q: debouncedQuery.trim() || undefined,
      });
      setSessions((prev) => {
        const merged = [...prev, ...next.items];
        merged.sort(
          (a, b) =>
            parseSessionStart(a.start_time).getTime() -
            parseSessionStart(b.start_time).getTime(),
        );
        return merged;
      });
      setHasMore(next.offset + next.items.length < next.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [debouncedQuery, sessions.length, hasMore, loadingMore]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    return sessions.filter((s) => {
      const start = parseSessionStart(s.start_time).getTime();
      const upcoming = start >= now;
      const weekly = s.game_template_id != null;
      const inNext7 = start >= now && start <= now + weekMs;
      if (filter === "upcoming" && !upcoming) return false;
      if (filter === "past" && upcoming) return false;
      if (filter === "weekly" && !weekly) return false;
      if (filter === "next7" && !inNext7) return false;
      return true;
    });
  }, [sessions, filter]);

  const visibleRows = useMemo(() => {
    return filtered.slice(0, pageSize);
  }, [filtered, pageSize]);

  async function performDelete(id: number) {
    setDeletingId(id);
    try {
      await adminDeleteSession(id);
      hapticLight();
      showToast("Session deleted.", "success");
      await reloadFirstPage();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed", "error");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  /* ── Filter chips data ──────────────────────────────── */

  const filters: { key: SessionFilter; label: string; count?: number }[] =
    useMemo(() => {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      return [
        { key: "all" as const, label: "All" },
        {
          key: "upcoming" as const,
          label: "Upcoming",
          count: sessions.filter(
            (s) => parseSessionStart(s.start_time).getTime() >= now,
          ).length,
        },
        {
          key: "past" as const,
          label: "Past",
          count: sessions.filter(
            (s) => parseSessionStart(s.start_time).getTime() < now,
          ).length,
        },
        {
          key: "next7" as const,
          label: "Next 7d",
          count: sessions.filter((s) => {
            const t = parseSessionStart(s.start_time).getTime();
            return t >= now && t <= now + weekMs;
          }).length,
        },
        {
          key: "weekly" as const,
          label: "Weekly",
          count: sessions.filter((s) => s.game_template_id != null).length,
        },
      ];
    }, [sessions]);

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div className="max-w-3xl mx-auto">
      <AdminPageHeader
        breadcrumb={
          <AdminBreadcrumb
            items={[{ label: "Admin", to: "/admin" }, { label: "Sessions" }]}
          />
        }
        title="Sessions"
        subtitle="Create and manage meetups, attendance, and waitlists."
        action={
          <Link
            to="/admin/sessions/new"
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors shrink-0 active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New session</span>
          </Link>
        }
      />

      {error && (
        <div
          className="mb-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* ── Search + Filters ──────────────────────────── */}

      {!loading && sessions.length > 0 && (
        <div className="flex flex-col gap-3 mb-4">
          {/* Search */}
          <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
            <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            <input
              id="admin-sessions-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by location…"
              className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none focus:ring-0 dark:text-white"
              aria-label="Filter sessions by location"
            />
          </label>

          {/* Filter chips — horizontal scroll on mobile */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filters.map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`inline-flex items-center gap-1.5 shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                  filter === key
                    ? "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-200"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-gray-600"
                }`}
              >
                {label}
                {count != null && (
                  <span
                    className={
                      filter === key
                        ? "text-violet-500 dark:text-violet-400"
                        : "text-gray-500 dark:text-gray-400"
                    }
                  >
                    {count}
                  </span>
                )}
              </button>
            ))}
            <div className="w-px py-1 bg-gray-200 dark:bg-gray-700 shrink-0 mx-1" />
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="shrink-0 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs text-gray-600 dark:text-gray-400"
              aria-label="Rows per page"
            >
              {[10, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n} rows
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* ── Session list ──────────────────────────────── */}

      {loading ? (
        <ul
          className="space-y-2"
          aria-busy="true"
          aria-label="Loading sessions"
        >
          <SessionRowSkeleton />
          <SessionRowSkeleton />
          <SessionRowSkeleton />
        </ul>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
          <Calendar className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            No sessions yet. Create the first one.
          </p>
          <Link
            to="/admin/sessions/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            Create session
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-12 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
          No sessions match your filters.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {visibleRows.map((s) => {
              const start = parseSessionStart(s.start_time);
              const upcoming = start.getTime() >= Date.now();
              const confirmed = s.confirmed_count ?? 0;
              const cap = Math.max(1, s.max_players);
              const countdown =
                upcoming && start.getTime() > Date.now()
                  ? formatDistanceToNow(start, { addSuffix: true })
                  : null;

              return (
                <li
                  key={s.id}
                  className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden transition-colors hover:border-gray-300 dark:hover:border-gray-700"
                >
                  <div className="flex">
                    {/* Clickable card body */}
                    <Link
                      to={`/admin/sessions/${s.id}`}
                      className="flex-1 min-w-0 p-3.5 active:bg-gray-50/50 dark:active:bg-gray-800/30 transition-colors"
                    >
                      {/* Date + time row */}
                      <div className="flex items-center gap-2">
                        {/* Status dot */}
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            upcoming
                              ? "bg-emerald-500 dark:bg-emerald-400"
                              : "bg-gray-300 dark:bg-gray-600"
                          }`}
                        />
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {format(start, "EEE, d MMM")}
                        </span>
                        <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
                          {format(start, "HH:mm")}
                        </span>
                        {countdown ? (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 ml-auto shrink-0">
                            {countdown}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto shrink-0">
                            ended
                          </span>
                        )}
                      </div>

                      {/* Location */}
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                          {s.location}
                        </span>
                      </div>

                      {/* Metadata chips */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-2xs font-medium text-gray-600 dark:text-gray-400">
                          <Users className="w-3 h-3" />
                          {s.min_players}–{s.max_players}
                        </span>
                        <span className="inline-flex items-center rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-2xs text-gray-500 dark:text-gray-400 capitalize">
                          {s.waitlist_mode.replace("_", " ")}
                        </span>
                        {s.game_template_id != null && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 dark:bg-violet-950/40 px-2 py-0.5 text-2xs font-medium text-violet-700 dark:text-violet-300">
                            <Repeat className="w-3 h-3" />
                            Weekly
                          </span>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="mt-2.5">
                        <ProgressBar value={confirmed} max={cap} />
                      </div>
                    </Link>

                    {/* Delete button — subtle icon on right */}
                    <div className="flex items-start border-l border-gray-100 dark:border-gray-800">
                      <button
                        type="button"
                        onClick={() => {
                          hapticLight();
                          setConfirmDeleteId(s.id);
                        }}
                        disabled={deletingId === s.id}
                        className="min-h-[44px] w-11 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
                        aria-label={`Delete session at ${s.location}`}
                      >
                        {deletingId === s.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {filtered.length > pageSize ? (
            <p className="text-center text-xs text-gray-500 dark:text-gray-400 mt-3">
              Showing {Math.min(pageSize, filtered.length)} of {filtered.length}{" "}
              matching (adjust &quot;rows&quot;).
            </p>
          ) : null}

          {hasMore && (
            <div className="flex justify-center mt-4">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Load more
              </button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDeleteId != null}
        title="Delete this session?"
        description="This permanently removes the meetup and its attendance. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId != null) void performDelete(confirmDeleteId);
        }}
      />
    </div>
  );
}
