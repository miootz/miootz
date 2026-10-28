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

const TEAM_COLORS = [
  "var(--color-team-a)",
  "var(--color-team-b)",
  "var(--color-raised)",
  "var(--color-raised)",
  "var(--color-raised)",
];

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
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-xl sm:text-2xl font-bold text-ink">
                    {format(parseMeetupStart(detail.start_time), "EEEE, d MMMM")}
                    <span className="ml-2 text-lg font-semibold text-ink-dim tabular-nums">
                      {format(parseMeetupStart(detail.start_time), "HH:mm")}
                    </span>
                  </h2>
                  <MeetupWeatherBadge meetupId={detail.id} />
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-dim">
                  <MapPin className="w-3.5 h-3.5 text-ink-faint shrink-0" aria-hidden />
                  <span className="truncate">{detail.location}</span>
                </p>
                <div className="mt-3 max-w-md">
                  <CapacityBar
                    confirmed={confirmed}
                    max={detail.max_players}
                    min={detail.min_players}
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1 text-ink-dim font-medium">
                      <Clock className="w-3.5 h-3.5" aria-hidden />
                      {formatDistanceToNow(parseMeetupStart(detail.start_time), {
                        addSuffix: true,
                      })}
                    </span>
                    {waitlisted > 0 && (
                      <span className="text-ink-faint">
                        {waitlisted} waitlisted
                      </span>
                    )}
                    <span className="text-ink-faint">
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
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 bg-ink text-board text-sm font-bold hover:bg-white/90 transition-colors active:scale-[0.98]"
                >
                  Manage meetup
                  <ChevronRight className="w-4 h-4" aria-hidden />
                </Link>
                <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-stretch">
                  {(matchActive || (meetupActive && !currentMatch)) && (
                    <Link
                      to={`/meetup-matches/${detail.id}`}
                      className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 text-sm font-bold transition-colors active:scale-[0.98] ${
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
                  {detail.team_assignment_mode === "random" && (
                    <button
                      type="button"
                      onClick={() => void reshuffleTeams()}
                      disabled={reshuffling}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 border border-line text-ink-dim hover:bg-raised hover:text-ink text-sm font-medium disabled:opacity-60 transition-colors active:scale-[0.98]"
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
                    className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 border border-line text-ink-dim hover:bg-raised hover:text-ink text-sm font-medium transition-colors active:scale-[0.98]"
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
            <section className="lg:col-span-3 border border-line bg-panel overflow-hidden">
              <header className="flex items-center gap-2 px-4 py-3 border-b border-line">
                <Users className="w-4 h-4 text-ink-faint" aria-hidden />
                <h2 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink">
                  Roster
                </h2>
                <span className="text-2xs text-ink-faint tabular-nums">
                  {confirmed} confirmed · {waitlisted} waitlisted
                </span>
                <span
                  className={`ml-auto inline-flex items-center gap-1.5 text-2xs font-medium ${
                    live ? "text-live" : "text-ink-faint"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      live ? "bg-live" : "bg-ink-faint"
                    }`}
                    aria-hidden
                  />
                  {live ? "Live" : "Offline"}
                </span>
                <Link
                  to={`/admin/meetups/${detail.id}`}
                  className="text-2xs font-medium text-ink-dim hover:text-ink hover:underline"
                >
                  Manage all
                </Link>
              </header>

              <div className="divide-y divide-line">
                {confirmed === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-ink-dim">
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
                    <h3 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                      Waitlist
                    </h3>
                    <span className="text-2xs text-ink-faint tabular-nums">
                      {waitlisted}
                    </span>
                    {confirmed < detail.max_players && (
                      <button
                        type="button"
                        onClick={() => void confirmAllWaitlisted()}
                        disabled={bulkConfirming}
                        className="ml-auto inline-flex items-center gap-1 min-h-[36px] px-2.5 border border-team-a/40 text-team-a text-xs font-medium bg-team-a/15 hover:bg-team-a/25 disabled:opacity-50 transition-colors"
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
                  <div className="divide-y divide-line">
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
                                  className="min-h-[36px] px-2.5 border border-team-a/40 text-team-a text-xs font-medium bg-team-a/15 hover:bg-team-a/25 disabled:opacity-50 transition-colors"
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
                                <span className="text-2xs text-ink-faint">
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
          <section className="mt-4 border border-line bg-panel p-4">
            <header className="flex items-center gap-2 mb-3">
              <LayoutGrid className="w-4 h-4 text-ink-faint" aria-hidden />
              <h2 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink">
                Teams
              </h2>
              {teams && teams.teams.length > 0 && (
                <span className="text-2xs text-ink-faint tabular-nums">
                  {teams.teams.length} team{teams.teams.length !== 1 ? "s" : ""}
                </span>
              )}
              <Link
                to={`/admin/meetups/${detail.id}`}
                className="ml-auto text-2xs font-medium text-ink-dim hover:text-ink hover:underline"
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
                      <span className="text-xs font-semibold text-ink">
                        {team.name ?? `Team ${idx + 1}`}
                      </span>
                      <span className="text-2xs text-ink-faint tabular-nums">
                        {team.players.length}
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {team.players.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center gap-2 px-2 py-1 bg-raised/50"
                        >
                          <PlayerAvatarFace
                            name={p.name}
                            avatarUrl={p.profilePic ?? undefined}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1 truncate text-xs text-ink">
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
              <p className="text-sm text-ink-dim py-3 text-center">
                Teams form automatically as players confirm.
              </p>
            )}
          </section>
        </>
      ) : (
        /* ── No upcoming meetup ─────────────────────────── */
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
          to="/admin/users"
          className="inline-flex items-center gap-2 text-sm font-medium text-ink-dim hover:text-ink transition-colors"
        >
          <Users className="w-4 h-4" aria-hidden />
          Users
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
          <span className="truncate text-sm font-medium text-ink">
            {name}
          </span>
          {isPlusOne && (
            <span className="shrink-0 bg-pink-500/15 px-1.5 py-0.5 text-2xs font-medium text-pink-400">
              +1
            </span>
          )}
        </div>
        {posLabel && (
          <p className="text-2xs text-ink-faint">{posLabel}</p>
        )}
      </div>
      <SkillBadge score={Math.min(5, Math.max(1, Math.round(skill)))} size="sm" />
      {action}
    </div>
  );
}
