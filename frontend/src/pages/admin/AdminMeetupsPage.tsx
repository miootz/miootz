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
import { fetchMeetups, type MeetupListItem } from "../../api/meetupsApi";
import { parseMeetupStart } from "../../utils/datetime";
import { adminDeleteMeetup } from "../../api/adminApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";
import { useToast } from "../../context/ToastContext";
import { hapticLight } from "../../utils/haptics";

const PAGE_SIZE = 50;

type MeetupFilter = "all" | "upcoming" | "past" | "weekly" | "next7";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/* ── Skeleton ─────────────────────────────────────────── */

function MeetupRowSkeleton() {
  return (
    <li className="border border-line bg-panel p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="h-4 w-4 bg-raised mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="h-4 w-24 bg-raised" />
            <div className="h-4 w-12 bg-raised" />
          </div>
          <div className="h-4 w-3/4 max-w-xs bg-raised" />
          <div className="flex gap-2">
            <div className="h-5 w-20 bg-raised" />
            <div className="h-5 w-16 bg-raised" />
          </div>
          <div className="h-1 bg-raised" />
        </div>
      </div>
    </li>
  );
}

/* ── Compact progress bar ─────────────────────────────── */

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-raised overflow-hidden">
        <div
          className="h-full bg-ink-dim transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-2xs tabular-nums text-ink-faint shrink-0 leading-none">
        {value}/{max}
      </span>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────── */

export function AdminMeetupsPage() {
  const { showToast } = useToast();
  const [meetups, setMeetups] = useState<MeetupListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 300);
  const [filter, setFilter] = useState<MeetupFilter>("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState(25);

  const reloadFirstPage = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchMeetups({
        limit: PAGE_SIZE,
        offset: 0,
        q: debouncedQuery.trim() || undefined,
      });
      const list = res.items;
      setMeetups(
        [...list].sort(
          (a, b) =>
            parseMeetupStart(a.start_time).getTime() -
            parseMeetupStart(b.start_time).getTime(),
        ),
      );
      setHasMore(res.offset + res.items.length < res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load meetups");
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
      const next = await fetchMeetups({
        limit: PAGE_SIZE,
        offset: meetups.length,
        q: debouncedQuery.trim() || undefined,
      });
      setMeetups((prev) => {
        const merged = [...prev, ...next.items];
        merged.sort(
          (a, b) =>
            parseMeetupStart(a.start_time).getTime() -
            parseMeetupStart(b.start_time).getTime(),
        );
        return merged;
      });
      setHasMore(next.offset + next.items.length < next.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [debouncedQuery, meetups.length, hasMore, loadingMore]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    return meetups.filter((s) => {
      const start = parseMeetupStart(s.start_time).getTime();
      const upcoming = start >= now;
      const weekly = s.game_template_id != null;
      const inNext7 = start >= now && start <= now + weekMs;
      if (filter === "upcoming" && !upcoming) return false;
      if (filter === "past" && upcoming) return false;
      if (filter === "weekly" && !weekly) return false;
      if (filter === "next7" && !inNext7) return false;
      return true;
    });
  }, [meetups, filter]);

  const visibleRows = useMemo(() => {
    return filtered.slice(0, pageSize);
  }, [filtered, pageSize]);

  async function performDelete(id: number) {
    setDeletingId(id);
    try {
      await adminDeleteMeetup(id);
      hapticLight();
      showToast("Meetup deleted.", "success");
      await reloadFirstPage();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed", "error");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  /* ── Filter chips data ──────────────────────────────── */

  const filters: { key: MeetupFilter; label: string; count?: number }[] =
    useMemo(() => {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      return [
        { key: "all" as const, label: "All" },
        {
          key: "upcoming" as const,
          label: "Upcoming",
          count: meetups.filter(
            (s) => parseMeetupStart(s.start_time).getTime() >= now,
          ).length,
        },
        {
          key: "past" as const,
          label: "Past",
          count: meetups.filter(
            (s) => parseMeetupStart(s.start_time).getTime() < now,
          ).length,
        },
        {
          key: "next7" as const,
          label: "Next 7d",
          count: meetups.filter((s) => {
            const t = parseMeetupStart(s.start_time).getTime();
            return t >= now && t <= now + weekMs;
          }).length,
        },
        {
          key: "weekly" as const,
          label: "Weekly",
          count: meetups.filter((s) => s.game_template_id != null).length,
        },
      ];
    }, [meetups]);

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div className="max-w-3xl mx-auto">
      <AdminPageHeader
        breadcrumb={
          <AdminBreadcrumb
            items={[{ label: "Admin", to: "/admin" }, { label: "Meetups" }]}
          />
        }
        title="Meetups"
        action={
          <Link
            to="/admin/meetups/new"
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 text-sm font-medium text-ink-dim hover:text-ink transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            One-off
          </Link>
        }
      />

      {error && (
        <div
          className="mb-4 border border-danger/40 bg-danger/15 px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* ── Search + Filters ──────────────────────────── */}

      {!loading && meetups.length > 0 && (
        <div className="flex flex-col gap-3 mb-4">
          {/* Search */}
          <label className="flex items-center gap-2 border border-line bg-raised px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            <input
              id="admin-meetups-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by location…"
              className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-faint focus:outline-hidden focus:ring-0"
              aria-label="Filter meetups by location"
            />
          </label>

          {/* Filter chips — horizontal scroll on mobile */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filters.map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`inline-flex items-center gap-1.5 shrink-0 border px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                  filter === key
                    ? "border-live/40 bg-live/15 text-live"
                    : "border-line bg-panel text-ink-dim hover:border-ink-faint"
                }`}
              >
                {label}
                {count != null && (
                  <span
                    className={
                      filter === key
                        ? "text-live"
                        : "text-ink-faint"
                    }
                  >
                    {count}
                  </span>
                )}
              </button>
            ))}
            <div className="w-px py-1 bg-line shrink-0 mx-1" />
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="shrink-0 border border-line bg-raised px-2 py-1.5 text-xs text-ink-dim"
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

      {/* ── Meetup list ──────────────────────────────── */}

      {loading ? (
        <ul
          className="space-y-2"
          aria-busy="true"
          aria-label="Loading meetups"
        >
          <MeetupRowSkeleton />
          <MeetupRowSkeleton />
          <MeetupRowSkeleton />
        </ul>
      ) : meetups.length === 0 ? (
        <div className="border border-line bg-panel p-12 text-center">
          <Calendar className="w-12 h-12 mx-auto text-ink-faint mb-4" />
          <p className="text-ink-dim mb-6">
            No meetups yet. Create an active template and meetups are scheduled
            automatically.
          </p>
          <Link
            to="/admin/game-templates"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-board text-sm font-bold hover:bg-white/90 active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            Create template
          </Link>
          <p className="mt-4 text-sm">
            <Link
              to="/admin/meetups/new"
              className="text-ink-faint hover:text-ink"
            >
              Or create a one-off meetup
            </Link>
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-ink-dim py-12 border border-dashed border-line">
          No meetups match your filters.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {visibleRows.map((s) => {
              const start = parseMeetupStart(s.start_time);
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
                  className="border border-line bg-panel overflow-hidden transition-colors hover:border-ink-faint"
                >
                  <div className="flex">
                    {/* Clickable card body */}
                    <Link
                      to={`/admin/meetups/${s.id}`}
                      className="flex-1 min-w-0 p-3.5 active:bg-raised/50 transition-colors"
                    >
                      {/* Date + time row */}
                      <div className="flex items-center gap-2">
                        {/* Status dot */}
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            upcoming ? "bg-live" : "bg-ink-faint"
                          }`}
                        />
                        <span className="text-sm font-medium text-ink">
                          {format(start, "EEE, d MMM")}
                        </span>
                        <span className="text-sm text-ink-dim tabular-nums">
                          {format(start, "HH:mm")}
                        </span>
                        {countdown ? (
                          <span className="text-xs text-live ml-auto shrink-0">
                            {countdown}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-faint ml-auto shrink-0">
                            ended
                          </span>
                        )}
                      </div>

                      {/* Location */}
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-ink-faint shrink-0" />
                        <span className="text-sm font-semibold text-ink truncate">
                          {s.location}
                        </span>
                      </div>

                      {/* Metadata chips */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 bg-raised px-2 py-0.5 text-2xs font-medium text-ink-dim">
                          <Users className="w-3 h-3" />
                          {s.min_players}–{s.max_players}
                        </span>
                        <span className="inline-flex items-center bg-raised px-2 py-0.5 text-2xs text-ink-dim capitalize">
                          {s.waitlist_mode.replace("_", " ")}
                        </span>
                        {s.game_template_id != null && (
                          <span className="inline-flex items-center gap-1 bg-raised px-2 py-0.5 text-2xs font-medium text-ink-dim">
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
                    <div className="flex items-start border-l border-line">
                      <button
                        type="button"
                        onClick={() => {
                          hapticLight();
                          setConfirmDeleteId(s.id);
                        }}
                        disabled={deletingId === s.id}
                        className="min-h-[44px] w-11 flex items-center justify-center text-ink-faint hover:text-danger hover:bg-danger/10 disabled:opacity-50 transition-colors"
                        aria-label={`Delete meetup at ${s.location}`}
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
            <p className="text-center text-xs text-ink-faint mt-3">
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
                className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 border border-line text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-50 transition-colors"
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
        title="Delete this meetup?"
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
