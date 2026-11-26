import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  ClipboardList,
  CloudRain,
  ExternalLink,
  LayoutGrid,
  Loader2,
  Play,
  Settings2,
  Trophy,
} from "lucide-react";
import {
  fetchMeetupDetail,
  grantWeatherHero,
  type MeetupDetail,
} from "../../api/meetupsApi";
import {
  adminUpdateMeetup,
  type TeamAssignmentMode,
  type WaitlistMode,
} from "../../api/adminApi";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { MatchHistoryList } from "../../components/MatchHistoryList";
import { MeetupWeatherBadge } from "../../components/MeetupWeatherBadge";
import { StickyFormBar } from "../../components/StickyFormBar";
import { MeetupTeamsPanel } from "../../components/MeetupTeamsPanel";
import { MeetupAttendancePanel } from "../../components/MeetupAttendancePanel";
import { useToast } from "../../context/ToastContext";
import {
  parseMeetupStart,
  meetupStartToDatetimeLocalValue,
} from "../../utils/datetime";

export function AdminMeetupDetailPage() {
  const { showToast } = useToast();
  const { meetupId } = useParams<{ meetupId: string }>();
  const id = meetupId ? parseInt(meetupId, 10) : NaN;

  const [detail, setDetail] = useState<MeetupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [startLocal, setStartLocal] = useState("");
  const [location, setLocation] = useState("");
  const [fee, setFee] = useState("0");
  const [minPlayers, setMinPlayers] = useState("10");
  const [maxPlayers, setMaxPlayers] = useState("15");
  const [waitlistMode, setWaitlistMode] =
    useState<WaitlistMode>("auto_promote");
  const [teamMode, setTeamMode] = useState<TeamAssignmentMode>("auto-balanced");
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const [savingMeta, setSavingMeta] = useState(false);
  const [tab, setTab] = useState<"details" | "attendance" | "teams" | "scores">(
    "details",
  );

  const load = useCallback(async () => {
    if (Number.isNaN(id)) return;
    setError(null);
    try {
      const d = await fetchMeetupDetail(id);
      setDetail(d);
      setStartLocal(meetupStartToDatetimeLocalValue(d.start_time));
      setLocation(d.location);
      setFee(d.fee_text ?? String(d.fee));
      setMinPlayers(String(d.min_players));
      setMaxPlayers(String(d.max_players));
      setWaitlistMode(
        d.waitlist_mode === "broadcast" ? "broadcast" : "auto_promote",
      );
      setTeamMode(
        d.team_assignment_mode === "random" || d.team_assignment_mode === "auto-balanced"
          ? d.team_assignment_mode
          : "balanced",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    if (Number.isNaN(id)) return;
    const min = Number(minPlayers);
    const max = Number(maxPlayers);
    if (max < min) {
      setError("Max players must be ≥ min players.");
      return;
    }
    setSavingMeta(true);
    setError(null);
    try {
      await adminUpdateMeetup(id, {
        start_time: new Date(startLocal).toISOString(),
        location: location.trim(),
        fee: Number(fee) || 0,
        fee_text: fee.trim() || null,
        min_players: min,
        max_players: max,
        waitlist_mode: waitlistMode,
        team_assignment_mode: teamMode,
      });
      await load();
      showToast("Meetup updated.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingMeta(false);
    }
  }

  // ── Tab definitions ─────────────────────────────────────────────

  const tabs: {
    key: typeof tab;
    label: string;
    icon: typeof ArrowLeft;
    badge?: number;
  }[] = [
    { key: "details", label: "Details", icon: Settings2 },
    {
      key: "attendance",
      label: "Attendance",
      icon: ClipboardList,
      badge: detail?.attendees.length,
    },
    { key: "teams", label: "Teams", icon: LayoutGrid },
    { key: "scores", label: "Scores", icon: Trophy },
  ];

  // ── Loading / error states ──────────────────────────────────────

  if (Number.isNaN(id)) {
    return (
      <p className="text-danger">Invalid meetup id.</p>
    );
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 motion-safe:animate-pulse motion-reduce:animate-none">
        <div className="h-4 w-48 bg-raised" />
        <div className="h-7 w-3/4 max-w-md bg-raised" />
        <div className="h-4 w-56 bg-raised" />
        <div className="h-48 bg-raised" />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="border border-danger/40 bg-danger/15 px-4 py-3 text-sm text-danger">
        {error}
      </div>
    );
  }

  if (!detail) return null;

  const startDate = parseMeetupStart(detail.start_time);
  const isPast = startDate.getTime() < Date.now();
  const kickoffFuture = startDate.getTime() > Date.now();
  const countdown = kickoffFuture
    ? formatDistanceToNow(startDate, { addSuffix: true })
    : null;
  // SAFETY: the meetups API may include an undeclared `current_match` object
  // ({ status, match_number }) in the meetup-detail payload; it is absent,
  // null, or that shape — never another type. The TS type lags behind the API.
  const currentMatch = (detail as unknown as Record<string, unknown>)
    .current_match as
    | { status: string; match_number: number }
    | null
    | undefined;
  const matchActive =
    currentMatch?.status === "active" || currentMatch?.status === "time_up";

  // ── Shared handlers ─────────────────────────────────────────────



  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className={`max-w-3xl mx-auto space-y-4 ${tab === "details" && detailsExpanded ? "pb-28" : "pb-8"}`}>
      {/* Breadcrumb */}
      <AdminBreadcrumb
        items={[
          { label: "Admin", to: "/admin" },
          { label: "Meetups", to: "/admin/meetups" },
          { label: detail.location },
        ]}
      />

      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/admin/meetups"
            className="inline-flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink mb-2 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All meetups
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold text-ink truncate">
            {detail.location}
          </h1>
          <p className="text-xs text-ink-faint mt-0.5">
            #{detail.id} · {format(startDate, "EEE, d MMM yyyy")} ·{" "}
            {format(startDate, "HH:mm")}
            {countdown ? (
              <span className="text-live ml-1">
                · {countdown}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!Number.isNaN(id) && <MeetupWeatherBadge meetupId={id} />}
        </div>
      </header>

      {/* Quick actions bar */}
      <div className="flex flex-wrap items-center gap-2">
        {matchActive && (
          <Link
            to={`/meetup-matches/${id}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-live text-board text-xs font-bold hover:bg-live/90 active:scale-[0.98] transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Manage match {currentMatch?.match_number ?? ""}
          </Link>
        )}
      </div>

      {/* Tabs — horizontal scrollable chips */}
      <div
        className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Meetup sections"
      >
        {tabs.map(({ key, label, icon: Icon, badge }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 shrink-0 border px-3.5 py-2 text-xs font-medium transition-colors active:scale-[0.97] ${
              tab === key
                ? "bg-ink text-board font-bold"
                : "border-line text-ink-dim hover:bg-raised hover:text-ink"
            }`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden />
            {label}
            {badge != null && (
              <span
                className={`text-2xs tabular-nums ${
                  tab === key ? "text-board/70" : "text-ink-faint"
                }`}
              >
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="border border-live/40 bg-live/15 px-4 py-3 text-sm text-live"
          role="status"
        >
          {error}
        </div>
      )}

      {/* ── Details tab ─────────────────────────────────────────── */}

      {tab === "details" && (
        <section>
          {/* Collapsed summary */}
          {!detailsExpanded && (
            <div className="border border-line bg-panel overflow-hidden">
              <div className="p-4 sm:p-6">
                <div className="grid sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-xs font-medium text-ink-dim">
                      Start time
                    </span>
                    <p className="text-ink mt-0.5 tabular-nums">
                      {format(startDate, "EEE, d MMM yyyy")} at{" "}
                      {format(startDate, "HH:mm")}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-ink-dim">
                      Location
                    </span>
                    <p className="text-ink mt-0.5 truncate">
                      {location}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-ink-dim">
                      Players
                    </span>
                    <p className="text-ink mt-0.5 tabular-nums">
                      {minPlayers}–{maxPlayers}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-ink-dim">
                      Fee
                    </span>
                    <p className="text-ink mt-0.5 tabular-nums">
                      {fee.trim() ? fee : '$0'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-ink-dim">
                      Team mode
                    </span>
                    <p className="text-ink mt-0.5">
                      {teamMode === "random"
                        ? "Random"
                        : teamMode === "auto-balanced"
                          ? "Auto-balanced"
                          : "Balanced (skill snake)"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-ink-dim">
                      Waitlist
                    </span>
                    <p className="text-ink mt-0.5 capitalize">
                      {waitlistMode === "broadcast"
                        ? "Broadcast"
                        : "Auto-promote"}
                    </p>
                  </div>
                </div>
                {detail.game_template_id && detail.game_template && (
                  <div className="mt-3 pt-3 border-t border-line">
                    <span className="text-xs font-medium text-ink-dim">
                      Template
                    </span>
                    <Link
                      to={`/admin/game-templates/${detail.game_template_id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-ink-dim hover:text-ink hover:underline ml-1"
                    >
                      &quot;{detail.game_template.name}&quot;
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetailsExpanded(true)}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-ink-dim border-t border-line hover:bg-raised hover:text-ink transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Edit details
              </button>
            </div>
          )}

          {/* Expanded form */}
          {detailsExpanded && (
            <>
            <form
              id="meetup-details-form"
              onSubmit={(e) => void saveMeta(e)}
              className="border border-line bg-panel p-4 sm:p-6 space-y-5"
            >
              <div>
                <h3 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim mb-3">
                  Schedule
                </h3>
                <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-ink-dim mb-1">
                      Start time
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={startLocal}
                      onChange={(e) => setStartLocal(e.target.value)}
                      className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-ink-dim mb-1">
                      Location
                    </label>
                    <input
                      type="text"
                      required
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim mb-3">
                  Settings
                </h3>
                <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-xs font-medium text-ink-dim mb-1">
                      Min players
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={minPlayers}
                      onChange={(e) => setMinPlayers(e.target.value)}
                      className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-dim mb-1">
                      Max players
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={maxPlayers}
                      onChange={(e) => setMaxPlayers(e.target.value)}
                      className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-dim mb-1">
                      Fee
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 8 credits"
                      value={fee}
                      onChange={(e) => setFee(e.target.value)}
                      className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-dim mb-1">
                      Waitlist mode
                    </label>
                    <select
                      value={waitlistMode}
                      onChange={(e) =>
                        setWaitlistMode(e.target.value as WaitlistMode)
                      }
                      className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
                    >
                      <option value="auto_promote">Auto-promote</option>
                      <option value="broadcast">Broadcast</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="meetup-team-assignment" className="block text-xs font-medium text-ink-dim mb-1">
                      Team assignment
                    </label>
                    <select
                      id="meetup-team-assignment"
                      value={teamMode}
                      onChange={(e) =>
                        setTeamMode(e.target.value as TeamAssignmentMode)
                      }
                      className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
                    >
                      <option value="auto-balanced">Auto-balanced</option>
                      <option value="balanced">Balanced (skill snake)</option>
                      <option value="random">Random order (snake)</option>
                    </select>
                    <p className="text-2xs text-ink-faint mt-1">
                      Random mode allows reshuffling teams without changing the
                      mode.
                    </p>
                  </div>
                </div>
              </div>

              {detail.game_template_id && detail.game_template && (
                <div className="border border-line bg-raised p-3 sm:p-4 space-y-1.5">
                  <p className="text-sm font-medium text-ink">
                    Template
                  </p>
                  <p className="text-xs text-ink-dim">
                    This meetup was created from the template below. Edit
                    schedule and defaults under Templates — this page is only
                    for this meetup instance.
                  </p>
                  <Link
                    to={`/admin/game-templates/${detail.game_template_id}`}
                    className="inline-flex text-sm font-medium text-ink-dim hover:text-ink hover:underline"
                  >
                    Open &quot;{detail.game_template.name}&quot;
                  </Link>
                </div>
              )}

            </form>

            <StickyFormBar innerClassName="max-w-3xl">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDetailsExpanded(false)}
                  className="flex-1 min-h-12 border border-line px-4 py-2.5 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="meetup-details-form"
                  disabled={savingMeta}
                  className="flex-1 min-h-12 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-ink text-board text-sm font-bold hover:bg-white/90 disabled:opacity-60 active:scale-[0.98]"
                >
                  {savingMeta ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : null}
                  Save changes
                </button>
              </div>
            </StickyFormBar>
            </>
          )}
        </section>
      )}

      {/* ── Attendance tab ──────────────────────────────────────── */}

      {tab === "attendance" && (
        <div className="space-y-4">
          {/* Weather Hero — one button grants every confirmed attendee */}
          <div className="border border-line bg-panel p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <CloudRain className="h-5 w-5 text-ink-dim flex-shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Weather Hero</p>
                <p className="text-xs text-ink-dim">
                  {detail.weather_hero_granted
                    ? "Granted to all confirmed attendees. Waitlisted holders can burn one to jump the queue."
                    : "Guarantees a spot: a waitlisted holder can redeem it to bump the last joiner out."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                setSavingMeta(true);
                try {
                  const res = await grantWeatherHero(id);
                  showToast(
                    res.granted > 0
                      ? `Weather Hero granted to ${res.granted} attendees`
                      : "All confirmed attendees already have it",
                    "success",
                  );
                  await load();
                } catch (e) {
                  showToast(
                    e instanceof Error ? e.message : "Grant failed",
                    "error",
                  );
                } finally {
                  setSavingMeta(false);
                }
              }}
              disabled={savingMeta}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-ink text-board text-xs font-bold hover:bg-white/90 disabled:opacity-50 active:scale-[0.98] flex-shrink-0"
            >
              {savingMeta ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CloudRain className="h-3.5 w-3.5" />
              )}
              {detail.weather_hero_granted ? "Grant to new" : "Grant to all"}
            </button>
          </div>
          <MeetupAttendancePanel
            meetupId={id}
            detail={detail}
            onChanged={load}
            isPast={isPast}
          />
        </div>
      )}

      {/* ── Teams tab ───────────────────────────────────────────── */}

      {tab === "teams" && (
        <MeetupTeamsPanel
          key={id}
          meetupId={id}
          detail={detail}
          onChanged={load}
          isPast={isPast}
        />
      )}

      {/* ── Scores tab ──────────────────────────────────────────── */}

      {tab === "scores" && (
        <section className="space-y-3">
          <MatchHistoryList meetupId={id} editable attendees={detail.attendees} />
        </section>
      )}

      {/* Footer */}
      <footer className="text-2xs text-ink-faint border-t border-line pt-4">
        Data revision #{detail.content_revision}
      </footer>
    </div>
  );
}
