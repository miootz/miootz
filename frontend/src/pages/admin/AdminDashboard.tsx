import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import {
  ChevronRight,
  Clock,
  LayoutGrid,
  Loader2,
  MapPin,
  Play,
  Plus,
  Repeat,
  Share2,
  Shuffle,
  UserCheck,
  Users,
  Wrench,
} from "lucide-react";
import {
  fetchMeetupDetail,
  fetchMeetupTeams,
  fetchMeetups,
  type MeetupDetail,
  type MeetupListItem,
  type TeamsResponse,
} from "../../api/meetupsApi";
import {
  adminListGameTemplates,
  adminMoveAttendance,
  adminReshuffleTeams,
  type GameTemplateRow,
} from "../../api/adminApi";
import { useAuth } from "../../auth/useAuth";
import { useToast } from "../../context/ToastContext";
import { subscribeMeetupData } from "../../utils/meetupDataBus";
import { parseMeetupStart } from "../../utils/datetime";
import { hapticLight } from "../../utils/haptics";
import { shareMeetup } from "../../utils/share";
import { MeetupChat } from "../../components/MeetupChat";
import { MeetupWeatherBadge } from "../../components/MeetupWeatherBadge";
import { PlayerAvatarFace, SkillBadge } from "../../components/PlayerAvatar";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";

const TEAM_COLORS = ["#0ea5e9", "#f43f5e", "#8b5cf6", "#22c55e", "#eab308"];

const SPECIALTY_LABELS: Record<string, string> = {
  ATT: "Attacker",
  MID: "Midfielder",
  DEF: "Defender",
  GK: "Goalkeeper",
};

function specialtyLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return SPECIALTY_LABELS[code] ?? code;
}

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
    pct >= 100 ? "bg-emerald-500" : confirmed < min ? "bg-amber-500" : "bg-sky-500";
  const minPct = max > 0 ? Math.min(100, Math.round((min / max) * 100)) : 0;
  return (
    <div>
      <div className="relative h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${colour} transition-[width]`}
          style={{ width: `${pct}%` }}
        />
        {/* min-players marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-gray-400/70 dark:bg-gray-500/70"
          style={{ left: `${minPct}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-1 flex items-center gap-2 text-2xs text-gray-500 dark:text-gray-400 tabular-nums">
        <span className="font-medium text-gray-700 dark:text-gray-300">
          {confirmed}/{max} confirmed
        </span>
        {confirmed < min && (
          <span className="font-medium text-amber-600 dark:text-amber-400">
            below min ({min})
          </span>
        )}
        {confirmed >= max && (
          <span className="font-medium text-emerald-600 dark:text-emerald-400">
            full
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Skeleton ───────────────────────────────────────────── */

function DashboardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 h-44" />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800/50 h-72" />
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800/50 h-72" />
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────── */

export function AdminDashboard() {
  const { tokens } = useAuth();
  const { showToast } = useToast();

  const [upcoming, setUpcoming] = useState<MeetupListItem[] | null>(null);
  const [templates, setTemplates] = useState<GameTemplateRow[] | null>(null);
  const [detail, setDetail] = useState<MeetupDetail | null>(null);
  const [teams, setTeams] = useState<TeamsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [reshuffling, setReshuffling] = useState(false);

  const nextId = upcoming?.[0]?.id ?? null;

  const loadDetailAndTeams = useCallback(async (id: number) => {
    const [d, t] = await Promise.all([
      fetchMeetupDetail(id),
      fetchMeetupTeams(id).catch(() => null),
    ]);
    setDetail(d);
    setTeams(t);
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [up, tpls] = await Promise.all([
        fetchMeetups({ status: "upcoming", order: "asc", limit: 5 }),
        adminListGameTemplates(),
      ]);
      setUpcoming(up.items);
      setTemplates(tpls.items);
      const next = up.items[0];
      if (next) {
        await loadDetailAndTeams(next.id);
      } else {
        setDetail(null);
        setTeams(null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, [loadDetailAndTeams]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates: refetch when the shared data feed reports a change.
  useEffect(() => {
    if (nextId == null) return;
    return subscribeMeetupData(
      nextId,
      tokens?.accessToken,
      () => void loadDetailAndTeams(nextId),
      setLive,
    );
  }, [nextId, tokens?.accessToken, loadDetailAndTeams]);

  async function moveUser(userId: number, next: "confirmed" | "waitlisted") {
    if (nextId == null) return;
    setMovingKey(`${userId}-${next}`);
    try {
      await adminMoveAttendance(nextId, userId, next);
      hapticLight();
      await loadDetailAndTeams(nextId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Move failed", "error");
    } finally {
      setMovingKey(null);
    }
  }

  async function confirmAllWaitlisted() {
    if (!detail || nextId == null) return;
    const waiters = detail.attendees.filter((a) => a.status === "waitlisted");
    if (waiters.length === 0) return;
    setBulkConfirming(true);
    try {
      for (const a of waiters) {
        await adminMoveAttendance(nextId, a.user_id, "confirmed");
      }
      hapticLight();
      await loadDetailAndTeams(nextId);
      showToast(`Confirmed ${waiters.length} player(s).`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Bulk confirm failed", "error");
    } finally {
      setBulkConfirming(false);
    }
  }

  async function reshuffleTeams() {
    if (nextId == null) return;
    setReshuffling(true);
    try {
      await adminReshuffleTeams(nextId);
      await loadDetailAndTeams(nextId);
      showToast("Teams reshuffled.", "success");
      hapticLight();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Reshuffle failed", "error");
    } finally {
      setReshuffling(false);
    }
  }

  function handleShare() {
    if (!detail) return;
    hapticLight();
    void shareMeetup({
      title: "Miootz meetup",
      text: `${detail.location} · ${format(parseMeetupStart(detail.start_time), "EEE d MMM HH:mm")}`,
      url: window.location.origin + "/",
    }).then((ok) =>
      showToast(
        ok ? "Link copied or shared." : "Could not share.",
        ok ? "success" : "error",
      ),
    );
  }

  const loading = upcoming === null && !err;

  /* ── Derived ──────────────────────────────────────────── */

  const confirmed = detail?.attendees.filter(
    (a) => a.status === "confirmed",
  ).length ?? 0;
  const waitlisted = detail?.attendees.filter(
    (a) => a.status === "waitlisted",
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
  const meetupActive =
    detail != null &&
    parseMeetupStart(detail.start_time).getTime() <= Date.now();

  /* ── Render ───────────────────────────────────────────── */

  return (
    <div className="max-w-6xl mx-auto">
      <AdminPageHeader
        breadcrumb={
          <AdminBreadcrumb
            items={[{ label: "Admin", to: "/admin" }, { label: "Overview" }]}
          />
        }
        title="Overview"
        subtitle="Live view of the next scheduled meetup, with the tools you need to run it."
      />

      {err && (
        <div
          className="mb-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
          role="alert"
        >
          <div className="flex items-center justify-between gap-3">
            <span>{err}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 text-sm font-medium text-teal-800 dark:text-teal-300 hover:underline"
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
          <section className="mb-4 rounded-2xl border border-teal-200 dark:border-teal-900/60 bg-gradient-to-br from-teal-50 to-white dark:from-teal-950/30 dark:to-gray-900 p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {format(parseMeetupStart(detail.start_time), "EEEE, d MMMM")}
                    <span className="ml-2 text-lg font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                      {format(parseMeetupStart(detail.start_time), "HH:mm")}
                    </span>
                  </h2>
                  <MeetupWeatherBadge meetupId={detail.id} />
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                  <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" aria-hidden />
                  <span className="truncate">{detail.location}</span>
                </p>
                <div className="mt-3 max-w-md">
                  <CapacityBar
                    confirmed={confirmed}
                    max={detail.max_players}
                    min={detail.min_players}
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                      <Clock className="w-3.5 h-3.5" aria-hidden />
                      {formatDistanceToNow(parseMeetupStart(detail.start_time), {
                        addSuffix: true,
                      })}
                    </span>
                    {waitlisted > 0 && (
                      <span className="text-gray-500 dark:text-gray-400">
                        {waitlisted} waitlisted
                      </span>
                    )}
                    <span className="text-gray-500 dark:text-gray-400">
                      {detail.team_assignment_mode === "random"
                        ? "random teams"
                        : "balanced teams"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-stretch sm:shrink-0">
                <Link
                  to={`/admin/meetups/${detail.id}`}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors active:scale-[0.98]"
                >
                  Manage meetup
                  <ChevronRight className="w-4 h-4" aria-hidden />
                </Link>
                <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-stretch">
                  {(matchActive || (meetupActive && !currentMatch)) && (
                    <Link
                      to={`/meetup-matches/${detail.id}`}
                      className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl text-sm font-medium text-white transition-colors active:scale-[0.98] ${
                        matchActive
                          ? "bg-amber-600 hover:bg-amber-700"
                          : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                    >
                      <Play className="w-4 h-4" aria-hidden />
                      {matchActive
                        ? `Manage match ${currentMatch?.match_number ?? ""}`
                        : "Start matches"}
                    </Link>
                  )}
                  {detail.team_assignment_mode === "random" && (
                    <button
                      type="button"
                      onClick={() => void reshuffleTeams()}
                      disabled={reshuffling}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60 transition-colors active:scale-[0.98]"
                    >
                      {reshuffling ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                      ) : (
                        <Shuffle className="w-4 h-4" aria-hidden />
                      )}
                      Reshuffle
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleShare}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors active:scale-[0.98]"
                  >
                    <Share2 className="w-4 h-4" aria-hidden />
                    Share
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ── Roster + chat ────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-5">
            <section className="lg:col-span-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
              <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <Users className="w-4 h-4 text-teal-500" aria-hidden />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Roster
                </h2>
                <span className="text-2xs text-gray-500 dark:text-gray-400 tabular-nums">
                  {confirmed} confirmed · {waitlisted} waitlisted
                </span>
                <span
                  className={`ml-auto inline-flex items-center gap-1.5 text-2xs font-medium ${
                    live
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-gray-400"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      live
                        ? "bg-emerald-500"
                        : "bg-gray-300 dark:bg-gray-600"
                    }`}
                    aria-hidden
                  />
                  {live ? "Live" : "Offline"}
                </span>
                <Link
                  to={`/admin/meetups/${detail.id}`}
                  className="text-2xs font-medium text-teal-800 dark:text-teal-300 hover:underline"
                >
                  Manage all
                </Link>
              </header>

              <div className="divide-y divide-gray-50 dark:divide-gray-800/60">
                {confirmed === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No one has signed up yet.
                  </p>
                )}
                {detail.attendees
                  .filter((a) => a.status === "confirmed")
                  .map((a) => (
                    <RosterRow
                      key={a.user_id}
                      name={a.display_name}
                      avatarUrl={a.avatar_url}
                      skill={a.skill}
                      primary={a.primary_specialty}
                      secondary={a.secondary_specialty}
                      isPlusOne={a.is_plus_one}
                    />
                  ))}
              </div>

              {waitlisted > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                    <h3 className="text-2xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                      Waitlist
                    </h3>
                    <span className="text-2xs text-gray-500 dark:text-gray-400 tabular-nums">
                      {waitlisted}
                    </span>
                    {confirmed < detail.max_players && (
                      <button
                        type="button"
                        onClick={() => void confirmAllWaitlisted()}
                        disabled={bulkConfirming}
                        className="ml-auto inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs font-medium bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 disabled:opacity-50 transition-colors"
                      >
                        {bulkConfirming ? (
                          <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                        ) : (
                          <UserCheck className="w-3 h-3" aria-hidden />
                        )}
                        Confirm all
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-gray-50 dark:divide-gray-800/60">
                    {detail.attendees
                      .filter((a) => a.status === "waitlisted")
                      .map((a) => {
                        const busy = movingKey === `${a.user_id}-confirmed`;
                        return (
                          <RosterRow
                            key={a.user_id}
                            name={a.display_name}
                            avatarUrl={a.avatar_url}
                            skill={a.skill}
                            primary={a.primary_specialty}
                            secondary={a.secondary_specialty}
                            isPlusOne={a.is_plus_one}
                            action={
                              confirmed < detail.max_players ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void moveUser(a.user_id, "confirmed")
                                  }
                                  className="min-h-[36px] px-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs font-medium bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 disabled:opacity-50 transition-colors"
                                >
                                  {busy ? (
                                    <Loader2
                                      className="w-3 h-3 animate-spin"
                                      aria-hidden
                                    />
                                  ) : (
                                    "Confirm"
                                  )}
                                </button>
                              ) : (
                                <span className="text-2xs text-gray-400">
                                  full
                                </span>
                              )
                            }
                          />
                        );
                      })}
                  </div>
                </div>
              )}
            </section>

            <div className="lg:col-span-2">
              <MeetupChat meetupId={String(detail.id)} />
            </div>
          </div>

          {/* ── Teams ────────────────────────────────────── */}
          <section className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4">
            <header className="flex items-center gap-2 mb-3">
              <LayoutGrid className="w-4 h-4 text-teal-500" aria-hidden />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Teams
              </h2>
              {teams && teams.teams.length > 0 && (
                <span className="text-2xs text-gray-500 dark:text-gray-400 tabular-nums">
                  {teams.teams.length} team{teams.teams.length !== 1 ? "s" : ""}
                </span>
              )}
              <Link
                to={`/admin/meetups/${detail.id}`}
                className="ml-auto text-2xs font-medium text-teal-800 dark:text-teal-300 hover:underline"
              >
                Manage teams
              </Link>
            </header>
            {teams && teams.teams.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {teams.teams.map((team, idx) => (
                  <div key={team.id}>
                    <div className="flex items-center gap-2 mb-1.5 px-1">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: TEAM_COLORS[idx % TEAM_COLORS.length],
                        }}
                        aria-hidden
                      />
                      <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                        {team.name ?? `Team ${idx + 1}`}
                      </span>
                      <span className="text-2xs text-gray-500 dark:text-gray-400 tabular-nums">
                        {team.players.length}
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {team.players.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center gap-2 rounded-lg px-2 py-1 bg-gray-50 dark:bg-gray-800/50"
                        >
                          <PlayerAvatarFace
                            name={p.name}
                            avatarUrl={p.profilePic ?? undefined}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1 truncate text-xs text-gray-800 dark:text-gray-200">
                            {p.name}
                          </span>
                          <SkillBadge
                            score={Math.min(
                              5,
                              Math.max(1, Math.round(p.skillScore)),
                            )}
                            size="sm"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-3 text-center">
                Teams form automatically as players confirm.
              </p>
            )}
          </section>
        </>
      ) : (
        /* ── No upcoming meetup ─────────────────────────── */
        <section className="mb-4 rounded-2xl border border-teal-200 dark:border-teal-900/60 bg-gradient-to-br from-teal-50 to-white dark:from-teal-950/30 dark:to-gray-900 p-6 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            No upcoming meetup
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {nextAnnounceAt
              ? `Signups open ${format(new Date(nextAnnounceAt), "EEEE, d MMMM · HH:mm")}.`
              : "Activate a template to schedule meetups automatically."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              to="/admin/game-templates"
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors"
            >
              <Repeat className="w-4 h-4" aria-hidden />
              Open templates
            </Link>
            <Link
              to="/admin/meetups/new"
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 text-sm font-medium text-teal-800 dark:text-teal-300 hover:underline"
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
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-1.5">
            <Repeat className="w-4 h-4 text-teal-500" aria-hidden />
            Auto-scheduled
            {activeTemplate && (
              <span className="text-2xs font-normal text-gray-500 dark:text-gray-400">
                from “{activeTemplate.name}”
              </span>
            )}
          </h2>
          <ul className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm divide-y divide-gray-50 dark:divide-gray-800/60 overflow-hidden">
            {upcoming.slice(1).map((m) => (
              <li key={m.id}>
                <Link
                  to={`/admin/meetups/${m.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                >
                  <div className="min-w-[88px] shrink-0">
                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                      {format(parseMeetupStart(m.start_time), "EEE, d MMM")}
                    </p>
                    <p className="text-2xs text-gray-500 dark:text-gray-400 tabular-nums">
                      {format(parseMeetupStart(m.start_time), "HH:mm")}
                    </p>
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                    {m.location}
                  </span>
                  <span className="shrink-0 text-2xs text-gray-500 dark:text-gray-400 tabular-nums">
                    {m.confirmed_count ?? 0}/{m.max_players}
                  </span>
                  <ChevronRight
                    className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0"
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
        className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-200 dark:border-gray-800 pt-4"
        aria-label="Admin sections"
      >
        <Link
          to="/admin/game-templates"
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
        >
          <Repeat className="w-4 h-4" aria-hidden />
          Templates
          {activeTemplate && (
            <span className="text-2xs font-normal text-gray-400 truncate max-w-40">
              active: {activeTemplate.name}
            </span>
          )}
        </Link>
        <Link
          to="/admin/users"
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
        >
          <Users className="w-4 h-4" aria-hidden />
          Users
        </Link>
        <Link
          to="/admin/tools"
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
        >
          <Wrench className="w-4 h-4" aria-hidden />
          Tools
        </Link>
      </nav>
    </div>
  );
}

/* ── Roster row ─────────────────────────────────────────── */

function RosterRow({
  name,
  avatarUrl,
  skill,
  primary,
  secondary,
  isPlusOne,
  action,
}: {
  name: string;
  avatarUrl: string | null;
  skill: number;
  primary?: string | null;
  secondary?: string | null;
  isPlusOne?: boolean;
  action?: React.ReactNode;
}) {
  const posLabel =
    [specialtyLabel(primary), specialtyLabel(secondary)]
      .filter(Boolean)
      .join("/") || null;
  return (
    <div className="flex items-center gap-2.5 px-4 py-2">
      <PlayerAvatarFace
        name={name}
        avatarUrl={avatarUrl ?? undefined}
        size="sm"
        isPlusOne={isPlusOne}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {name}
          </span>
          {isPlusOne && (
            <span className="shrink-0 rounded-full bg-teal-100 dark:bg-teal-950/60 px-1.5 py-0.5 text-2xs font-medium text-teal-800 dark:text-teal-300">
              +1
            </span>
          )}
        </div>
        {posLabel && (
          <p className="text-2xs text-gray-500 dark:text-gray-400">{posLabel}</p>
        )}
      </div>
      <SkillBadge score={Math.min(5, Math.max(1, Math.round(skill)))} size="sm" />
      {action}
    </div>
  );
}
