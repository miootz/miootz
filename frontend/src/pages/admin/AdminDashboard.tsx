import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import {
  ChevronRight,
  MapPin,
  Play,
  Plus,
  Repeat,
  SkipForward,
  Users,
  Wrench,
} from "lucide-react";
import {
  fetchMeetupDetail,
  fetchMeetups,
  skipMeetup,
  type MeetupDetail,
  type MeetupListItem,
} from "../../api/meetupsApi";
import {
  adminListGameTemplates,
  type GameTemplateRow,
} from "../../api/adminApi";
import { useAuth } from "../../auth/useAuth";
import { subscribeMeetupData } from "../../utils/meetupDataBus";
import { parseMeetupStart } from "../../utils/datetime";
import { MeetupChat } from "../../components/MeetupChat";
import { MeetupWeatherBadge } from "../../components/MeetupWeatherBadge";
import { MeetupTeamsPanel } from "../../components/MeetupTeamsPanel";
import { MeetupAttendancePanel } from "../../components/MeetupAttendancePanel";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";

/* ── Capacity bar ───────────────────────────────────────── */

function CapacityBar({
  confirmed,
  max,
  min,
}: {
  confirmed: number;
  max: number;
  min: number;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((confirmed / max) * 100)) : 0;
  const colour =
    pct >= 100 ? "bg-team-a" : confirmed < min ? "bg-live" : "bg-ink-dim";
  const minPct = max > 0 ? Math.min(100, Math.round((min / max) * 100)) : 0;
  return (
    <div>
      <div className="relative h-1.5 bg-raised overflow-hidden">
        <div
          className={`h-full ${colour} transition-[width]`}
          style={{ width: `${pct}%` }}
        />
        {/* min-players marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-ink/60"
          style={{ left: `${minPct}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-1 flex items-center gap-2 text-2xs text-ink-faint tabular-nums">
        <span className="font-medium text-ink-dim">
          {confirmed}/{max} confirmed
        </span>
        {confirmed < min && (
          <span className="font-medium text-live">below min ({min})</span>
        )}
        {confirmed >= max && (
          <span className="font-medium text-team-a">full</span>
        )}
      </div>
    </div>
  );
}

/* ── Skeleton ───────────────────────────────────────────── */

function DashboardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true">
      <div className="border border-line bg-panel p-5 h-44" />
      <div className="border border-line bg-raised h-72" />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 border border-line bg-raised h-72" />
        <div className="lg:col-span-2 border border-line bg-raised h-72" />
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────── */

export function AdminDashboard() {
  const { tokens } = useAuth();

  const [upcoming, setUpcoming] = useState<MeetupListItem[] | null>(null);
  const [templates, setTemplates] = useState<GameTemplateRow[] | null>(null);
  const [detail, setDetail] = useState<MeetupDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [detailFetchedAt, setDetailFetchedAt] = useState(0);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const skipResetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (skipResetTimer.current) window.clearTimeout(skipResetTimer.current);
    },
    [],
  );

  const nextId = detail?.id ?? null;

  const loadDetail = useCallback(async (id: number) => {
    const d = await fetchMeetupDetail(id);
    setDetail(d);
    setDetailFetchedAt(Date.now());
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [up, tpls] = await Promise.all([
        fetchMeetups({ status: "all", order: "asc", limit: 20 }),
        adminListGameTemplates(),
      ]);
      setUpcoming(up.items);
      setTemplates(tpls.items);
      // "Current" = first meetup whose local day (location timezone) has begun —
      // midnight ending the last meetup day through the night of the next one.
      const next = up.items.find((m) => m.is_current) ?? null;
      if (next) {
        await loadDetail(next.id);
      } else {
        setDetail(null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, [loadDetail]);

  const onSkip = useCallback(async () => {
    if (!detail) return;
    if (!confirmingSkip) {
      setConfirmingSkip(true);
      skipResetTimer.current = window.setTimeout(
        () => setConfirmingSkip(false),
        4000,
      );
      return;
    }
    if (skipResetTimer.current) window.clearTimeout(skipResetTimer.current);
    setConfirmingSkip(false);
    setDetail(null);
    try {
      await skipMeetup(detail.id);
    } finally {
      await load();
    }
  }, [detail, confirmingSkip, load]);

  useEffect(() => {
    // Data-fetching effect: populating state is the effect's purpose, not the
    // derived-state anti-pattern this rule targets.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Live updates: refetch when the shared data feed reports a change.
  useEffect(() => {
    if (nextId == null) return;
    return subscribeMeetupData(
      nextId,
      tokens?.accessToken,
      () => void loadDetail(nextId).catch(() => {}),
      setLive,
    );
  }, [nextId, tokens?.accessToken, loadDetail]);

  const loading = upcoming === null && !err;

  /* ── Derived ──────────────────────────────────────────── */

  const confirmed = detail?.attendees.filter(
    (a) => a.status === "confirmed",
  ).length ?? 0;
  const activeTemplate =
    templates?.find((t) => t.is_active) ?? templates?.[0] ?? null;
  const nextAnnounceAt = activeTemplate?.next_announce_at ?? null;

  // SAFETY: the meetups API may include an undeclared `current_match` object
  // ({ status, match_number }) in the detail payload; the TS type lags behind.
  const currentMatch = (detail as unknown as Record<string, unknown> | null)
    ? ((detail as unknown as Record<string, unknown>).current_match as
        | { status: string; match_number: number }
        | null
        | undefined)
    : undefined;
  const matchActive =
    currentMatch?.status === "active" || currentMatch?.status === "time_up";
  // "Has kickoff passed" — derived purely from the fetch timestamp (no impure
  // Date.now in render).
  const meetupActive =
    detail != null &&
    parseMeetupStart(detail.start_time).getTime() <= detailFetchedAt;

  /* ── Render ───────────────────────────────────────────── */

  return (
    <div className="max-w-6xl mx-auto">
      <AdminBreadcrumb
        items={[{ label: "Admin", to: "/admin" }, { label: "Overview" }]}
      />

      {err && (
        <div
          className="mb-4 border border-danger/40 bg-danger/15 px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <div className="flex items-center justify-between gap-3">
            <span>{err}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 text-sm font-medium text-ink hover:underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <DashboardSkeleton />
      ) : detail ? (
        <>
          {/* ── Next meetup command card ─────────────────── */}
          <section className="mb-4 border border-line bg-panel p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
              <div className="min-w-0">
                <h2 className="text-xl sm:text-2xl font-bold text-ink">
                  {format(parseMeetupStart(detail.start_time), "EEEE, d MMMM")}
                  <span className="ml-2 text-lg font-semibold text-ink-dim tabular-nums">
                    {format(parseMeetupStart(detail.start_time), "HH:mm")}
                  </span>
                </h2>
                <div className="mt-3 max-w-md">
                  <CapacityBar
                    confirmed={confirmed}
                    max={detail.max_players}
                    min={detail.min_players}
                  />
                  {(matchActive ||
                    (meetupActive && !currentMatch)) && (
                    <Link
                      to={`/meetup-matches/${detail.id}`}
                      className={`mt-3 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 text-sm font-bold transition-colors active:scale-[0.98] ${
                        matchActive
                          ? "bg-live text-board hover:bg-live/90"
                          : "bg-team-a text-white hover:bg-team-a/90"
                      }`}
                    >
                      <Play className="w-4 h-4" aria-hidden />
                      {matchActive
                        ? `Manage match ${currentMatch?.match_number ?? ""}`
                        : "Start matches"}
                    </Link>
                  )}
                </div>
              </div>

              {/* Location + weather */}
              <div className="flex flex-col items-start gap-2 md:border-l md:border-line md:pl-4">
                <p className="flex items-center gap-1.5 text-sm text-ink-dim">
                  <MapPin
                    className="w-3.5 h-3.5 text-ink-faint shrink-0"
                    aria-hidden
                  />
                  <span>{detail.location}</span>
                </p>
                <button
                  type="button"
                  onClick={() => void onSkip()}
                  className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-sm font-bold border transition-colors active:scale-[0.98] ${
                    confirmingSkip
                      ? "border-danger bg-danger/15 text-danger"
                      : "border-line text-ink-dim hover:bg-raised hover:text-ink"
                  }`}
                >
                  <SkipForward className="w-4 h-4" aria-hidden />
                  {confirmingSkip ? "Tap again to skip" : "Skip"}
                </button>
                <MeetupWeatherBadge meetupId={detail.id} />
              </div>
            </div>
          </section>

          {/* ── Teams — full management surface ──────────── */}
          <div className="mb-4">
            <MeetupTeamsPanel
              meetupId={detail.id}
              detail={detail}
              onChanged={() => loadDetail(detail.id)}
              live={live}
            />
          </div>

          {/* ── Attendance (left) + chat (right) ─────────── */}
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3 min-w-0">
              <MeetupAttendancePanel
                meetupId={detail.id}
                detail={detail}
                onChanged={() => loadDetail(detail.id)}
              />
            </div>
            <div className="lg:col-span-2 min-w-0">
              <MeetupChat
                meetupId={String(detail.id)}
                defaultExpanded
                fillHeight
              />
            </div>
          </div>
        </>
      ) : (
        /* ── No materialized meetup at all ── */
        <section className="mb-4 border border-line bg-panel p-6">
          <h2 className="text-xl font-bold text-ink">No upcoming meetup</h2>
          <p className="mt-1 text-sm text-ink-dim">
            {nextAnnounceAt
              ? `Signups open ${format(new Date(nextAnnounceAt), "EEEE, d MMMM · HH:mm")}.`
              : "Activate a template to schedule meetups automatically."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              to="/admin/game-templates"
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 bg-ink text-board text-sm font-bold hover:bg-white/90 transition-colors"
            >
              <Repeat className="w-4 h-4" aria-hidden />
              Open templates
            </Link>
            <Link
              to="/admin/meetups/new"
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 text-sm font-medium text-ink-dim hover:text-ink hover:underline"
            >
              <Plus className="w-4 h-4" aria-hidden />
              One-off meetup
            </Link>
          </div>
        </section>
      )}

      {/* ── Auto-scheduled list ──────────────────────────── */}
      {upcoming && upcoming.length > 1 && (
        <section className="mt-4">
          <h2 className="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
            <Repeat className="w-4 h-4 text-ink-faint" aria-hidden />
            Auto-scheduled
            {activeTemplate && (
              <span className="text-2xs font-normal text-ink-faint">
                from “{activeTemplate.name}”
              </span>
            )}
          </h2>
          <ul className="border border-line bg-panel divide-y divide-line overflow-hidden">
            {upcoming.slice(1).map((m) => (
              <li key={m.id}>
                <Link
                  to={`/admin/meetups/${m.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-raised transition-colors"
                >
                  <div className="min-w-[88px] shrink-0">
                    <p className="text-xs font-semibold text-ink">
                      {format(parseMeetupStart(m.start_time), "EEE, d MMM")}
                    </p>
                    <p className="text-2xs text-ink-faint tabular-nums">
                      {format(parseMeetupStart(m.start_time), "HH:mm")}
                    </p>
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-dim">
                    {m.location}
                  </span>
                  <span className="shrink-0 text-2xs text-ink-faint tabular-nums">
                    {m.confirmed_count ?? 0}/{m.max_players}
                  </span>
                  <ChevronRight
                    className="w-4 h-4 text-ink-faint shrink-0"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Quick links ──────────────────────────────────── */}
      <nav
        className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4"
        aria-label="Admin sections"
      >
        <Link
          to="/admin/game-templates"
          className="inline-flex items-center gap-2 text-sm font-medium text-ink-dim hover:text-ink transition-colors"
        >
          <Repeat className="w-4 h-4" aria-hidden />
          Templates
          {activeTemplate && (
            <span className="text-2xs font-normal text-ink-faint truncate max-w-40">
              active: {activeTemplate.name}
            </span>
          )}
        </Link>
        <Link
          to="/admin/players"
          className="inline-flex items-center gap-2 text-sm font-medium text-ink-dim hover:text-ink transition-colors"
        >
          <Users className="w-4 h-4" aria-hidden />
          Players
        </Link>
        <Link
          to="/admin/tools"
          className="inline-flex items-center gap-2 text-sm font-medium text-ink-dim hover:text-ink transition-colors"
        >
          <Wrench className="w-4 h-4" aria-hidden />
          Tools
        </Link>
      </nav>
    </div>
  );
}
