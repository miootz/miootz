import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  ClipboardList,
  ExternalLink,
  LayoutGrid,
  Loader2,
  Minus,
  Play,
  Plus,
  Search,
  Settings2,
  Share2,
  Shuffle,
  Trophy,
  UserCheck,
  Users,
} from "lucide-react";
import type { Meetup, Team, User } from "../../types";
import {
  fetchMeetupDetail,
  fetchMeetupTeams,
  patchMeetupTeams,
  type MeetupDetail,
  type TeamsResponse,
} from "../../api/meetupsApi";
import {
  adminAdjustTeams,
  adminMoveAttendance,
  adminReshuffleTeams,
  adminUpdateMeetup,
  type TeamAssignmentMode,
  type WaitlistMode,
} from "../../api/adminApi";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { MatchHistoryList } from "../../components/MatchHistoryList";
import { MeetupWeatherBadge } from "../../components/MeetupWeatherBadge";
import { PlayerAvatarFace, SkillBadge } from "../../components/PlayerAvatar";
import { DraggableTeams } from "../../components/DraggableTeams";
import { rebalanceTeams } from "../../services/teamService";
import { useToast } from "../../context/ToastContext";
import {
  parseMeetupStart,
  meetupStartToDatetimeLocalValue,
} from "../../utils/datetime";
import { hapticLight } from "../../utils/haptics";
import { shareMeetup } from "../../utils/share";

const SPECIALTY_LABELS: Record<string, string> = {
  ATT: "Attacker",
  MID: "Midfielder",
  DEF: "Defender",
  GK: "Goalkeeper",
};

function formatSpecialty(code: string | null | undefined): string | null {
  if (!code) return null;
  return SPECIALTY_LABELS[code] ?? code;
}

function mapTeamPlayers(team: TeamsResponse["teams"][0]): User[] {
  return team.players.map((p) => ({
    id: p.id,
    name: p.name,
    skillScore: p.skillScore,
    isLocked: p.isLocked,
    avatarUrl: p.profilePic ?? undefined,
    primarySpecialty: p.primarySpecialty ?? undefined,
    secondarySpecialty: p.secondarySpecialty ?? undefined,
    calculatedSkill: p.calculatedSkill ?? null,
  }));
}

/**
 * Build the local, drag-editable team state that DraggableTeams consumes.
 * `isLocked` is sourced from the server team payload; attendance carries the
 * rest of the player info.
 */
function buildTeamMeetup(
  detail: MeetupDetail | null,
  teams: TeamsResponse | null,
  numericId: number,
): Meetup | null {
  if (!teams) return null;
  const lockById = new Map<string, boolean>();
  teams.teams.forEach((t) =>
    t.players.forEach((p) => lockById.set(p.id, p.isLocked)),
  );
  const attendance: User[] = (detail?.attendees ?? [])
    .filter((a) => a.status === "confirmed")
    .map((a) => ({
      id: String(a.user_id),
      name: a.display_name,
      skillScore: a.skill,
      isLocked: lockById.get(String(a.user_id)) ?? false,
      avatarUrl: a.avatar_url ?? undefined,
      primarySpecialty: a.primary_specialty ?? undefined,
      secondarySpecialty: a.secondary_specialty ?? undefined,
      isPlusOne: a.is_plus_one,
      calculatedSkill: a.calculated_skill ?? null,
    }));
  const teamList: Team[] = teams.teams.map((t) => ({
    id: t.id,
    name: t.name,
    players: mapTeamPlayers(t),
  }));
  return {
    id: String(numericId),
    date: "",
    attendance,
    teams: teamList,
  };
}

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
  const [teamMode, setTeamMode] = useState<TeamAssignmentMode>("balanced");
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const [savingMeta, setSavingMeta] = useState(false);
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const [tab, setTab] = useState<"details" | "attendance" | "teams" | "scores">(
    "details",
  );
  const [attFilter, setAttFilter] = useState<
    "all" | "confirmed" | "waitlisted" | "cancelled"
  >("all");
  const [attSearch, setAttSearch] = useState("");
  const [teamsData, setTeamsData] = useState<TeamsResponse | null>(null);
  const [teamMeetup, setTeamMeetup] = useState<Meetup | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [reshuffling, setReshuffling] = useState(false);
  const [adjustingTeam, setAdjustingTeam] = useState<
    "expand" | "contract" | null
  >(null);

  const load = useCallback(async () => {
    if (Number.isNaN(id)) return;
    setError(null);
    try {
      const d = await fetchMeetupDetail(id);
      setDetail(d);
      setStartLocal(meetupStartToDatetimeLocalValue(d.start_time));
      setLocation(d.location);
      setFee(String(d.fee));
      setMinPlayers(String(d.min_players));
      setMaxPlayers(String(d.max_players));
      setWaitlistMode(
        d.waitlist_mode === "broadcast" ? "broadcast" : "auto_promote",
      );
      setTeamMode(d.team_assignment_mode === "random" ? "random" : "balanced");
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

  async function reshuffleTeams() {
    if (Number.isNaN(id)) return;
    setReshuffling(true);
    setError(null);
    try {
      await adminReshuffleTeams(id);
      await load();
      showToast("Teams reshuffled.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reshuffle failed");
    } finally {
      setReshuffling(false);
    }
  }

  async function adjustTeams(op: "expand" | "contract") {
    if (Number.isNaN(id)) return;
    setAdjustingTeam(op);
    setError(null);
    try {
      const result = await adminAdjustTeams(id, op, 1);
      await load();
      if (op === "expand") {
        const count = result.promoted_user_ids?.length ?? 0;
        showToast(
          count > 0
            ? `Added team — ${count} player(s) promoted from waitlist.`
            : "Team capacity increased.",
          "success",
        );
      } else {
        const count = result.returned_user_ids?.length ?? 0;
        showToast(
          count > 0
            ? `Removed team — ${count} player(s) returned to waitlist.`
            : "Team removed.",
          "success",
        );
      }
      hapticLight();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adjustment failed");
    } finally {
      setAdjustingTeam(null);
    }
  }

  async function moveUser(userId: number, next: "confirmed" | "waitlisted") {
    if (Number.isNaN(id)) return;
    setMovingKey(`${userId}-${next}`);
    setError(null);
    try {
      await adminMoveAttendance(id, userId, next);
      await load();
      hapticLight();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Move failed");
    } finally {
      setMovingKey(null);
    }
  }

  async function confirmAllWaitlisted() {
    if (!detail || Number.isNaN(id)) return;
    const waiters = detail.attendees.filter((a) => a.status === "waitlisted");
    if (waiters.length === 0) {
      showToast("No waitlisted players.", "success");
      return;
    }
    setBulkWorking(true);
    setError(null);
    try {
      for (const a of waiters) {
        await adminMoveAttendance(id, a.user_id, "confirmed");
      }
      await load();
      showToast(`Confirmed ${waiters.length} player(s).`, "success");
      hapticLight();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk confirm failed");
    } finally {
      setBulkWorking(false);
    }
  }

  useEffect(() => {
    if (tab !== "teams" || Number.isNaN(id)) return;
    let cancelled = false;
    setTeamsLoading(true);
    void fetchMeetupTeams(id)
      .then((t) => {
        if (cancelled) return;
        setTeamsData(t);
        setTeamMeetup(buildTeamMeetup(detail, t, id));
      })
      .catch(() => {
        if (!cancelled) setTeamsData(null);
      })
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, id, detail?.content_revision]);

  const handleToggleLock = useCallback((userId: string) => {
    setTeamMeetup((m) => {
      if (!m) return m;
      const attendance = m.attendance.map((u) =>
        u.id === userId ? { ...u, isLocked: !u.isLocked } : u,
      );
      return {
        ...m,
        attendance,
        teams: rebalanceTeams({ attendance, teams: m.teams }),
      };
    });
  }, []);

  const handleMovePlayer = useCallback(
    async (playerId: string, sourceTeamId: string, destTeamId: string) => {
      if (Number.isNaN(id) || !teamMeetup) return;
      const nextTeams = teamMeetup.teams.map((team) => {
        if (team.id === sourceTeamId) {
          return {
            ...team,
            players: team.players.filter((p) => p.id !== playerId),
          };
        }
        if (team.id === destTeamId) {
          const player = teamMeetup.attendance.find((p) => p.id === playerId);
          return player ? { ...team, players: [...team.players, player] } : team;
        }
        return team;
      });
      setTeamMeetup({ ...teamMeetup, teams: nextTeams });
      const payload = nextTeams.map((t) => t.players.map((p) => p.id));
      try {
        const res = await patchMeetupTeams(id, payload);
        setTeamsData(res);
        setTeamMeetup(buildTeamMeetup(detail, res, id));
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Could not save team lineup", "error");
        void load();
      }
    },
    [id, teamMeetup, detail, load, showToast],
  );

  const filteredAttendees = useMemo(() => {
    if (!detail) return [];
    const q = attSearch.trim().toLowerCase();
    return detail.attendees.filter((a) => {
      if (attFilter !== "all" && a.status !== attFilter) return false;
      if (q) {
        const name = a.display_name.toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    });
  }, [detail, attFilter, attSearch]);

  // ── Attendance counts for filter chips ──────────────────────────

  const attCounts = useMemo(() => {
    if (!detail) return { all: 0, confirmed: 0, waitlisted: 0, cancelled: 0 };
    return {
      all: detail.attendees.length,
      confirmed: detail.attendees.filter((a) => a.status === "confirmed")
        .length,
      waitlisted: detail.attendees.filter((a) => a.status === "waitlisted")
        .length,
      cancelled: detail.attendees.filter((a) => a.status === "cancelled")
        .length,
    };
  }, [detail]);

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
  const kickoffFuture = startDate.getTime() > Date.now();
  const countdown = kickoffFuture
    ? formatDistanceToNow(startDate, { addSuffix: true })
    : null;
  const meetupActive = !kickoffFuture;
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
  const canReshuffle = teamMode === "random";

  // ── Shared handlers ─────────────────────────────────────────────

  const handleShare = () => {
    hapticLight();
    void shareMeetup({
      title: "Miootz meetup",
      text: `${detail.location} · ${format(startDate, "EEE d MMM HH:mm")}`,
      url: window.location.origin + "/",
    }).then((ok) =>
      showToast(
        ok ? "Link copied or shared." : "Could not share.",
        ok ? "success" : "error",
      ),
    );
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-8">
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
        {meetupActive && !currentMatch && (
          <Link
            to={`/meetup-matches/${id}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-team-a text-white text-xs font-bold hover:bg-team-a/90 active:scale-[0.98] transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Start matches
          </Link>
        )}
        {canReshuffle && (
          <button
            type="button"
            disabled={reshuffling}
            onClick={() => void reshuffleTeams()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-line text-ink-dim hover:bg-raised hover:text-ink text-xs font-medium disabled:opacity-60 active:scale-[0.98] transition-colors"
          >
            {reshuffling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Shuffle className="w-3.5 h-3.5" />
            )}
            Reshuffle teams
          </button>
        )}
        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-line text-ink-dim hover:bg-raised hover:text-ink text-xs font-medium active:scale-[0.98] transition-colors"
        >
          <Share2 className="w-3.5 h-3.5" />
          Share
        </button>
      </div>

      {/* Tabs — horizontal scroll on desktop, accordion on mobile */}
      <div
        className="sm:hidden flex flex-col gap-2"
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
            className={`w-full flex items-center justify-between gap-2 border px-4 py-3 text-sm font-medium transition-colors active:scale-[0.99] ${
              tab === key
                ? "bg-ink text-board font-bold"
                : "border-line text-ink-dim hover:bg-raised hover:text-ink"
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon className="w-4 h-4" aria-hidden />
              {label}
            </div>
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

      <div
        className="hidden sm:flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                      ${Number(fee).toFixed(0)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-ink-dim">
                      Team mode
                    </span>
                    <p className="text-ink mt-0.5 capitalize">
                      {teamMode === "random"
                        ? "Random"
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
            <form
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
                      type="number"
                      min={0}
                      step="0.01"
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
                    <label className="block text-xs font-medium text-ink-dim mb-1">
                      Team assignment
                    </label>
                    <select
                      value={teamMode}
                      onChange={(e) =>
                        setTeamMode(e.target.value as TeamAssignmentMode)
                      }
                      className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
                    >
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

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={savingMeta}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-ink text-board text-sm font-bold hover:bg-white/90 disabled:opacity-60 active:scale-[0.98]"
                >
                  {savingMeta ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : null}
                  Save changes
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsExpanded(false)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-line text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink active:scale-[0.98]"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* ── Attendance tab ──────────────────────────────────────── */}

      {tab === "attendance" && (
        <section className="space-y-3">
          <p className="text-xs text-ink-faint">
            Cancelled spots require the player to rejoin from the app.
          </p>

          {/* Search + filters */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 border border-line bg-raised px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
              <input
                type="search"
                value={attSearch}
                onChange={(e) => setAttSearch(e.target.value)}
                placeholder="Search players…"
                className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-faint focus:outline-hidden"
                aria-label="Search attendance"
              />
            </label>

            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(["all", "confirmed", "waitlisted", "cancelled"] as const).map(
                (key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAttFilter(key)}
                    className={`shrink-0 border px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                      attFilter === key
                        ? "border-live/40 bg-live/15 text-live"
                        : "border-line bg-panel text-ink-dim hover:border-ink-faint"
                    }`}
                  >
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                    <span
                      className={`ml-1 text-2xs tabular-nums ${
                        attFilter === key ? "text-live" : "text-ink-faint"
                      }`}
                    >
                      {attCounts[key]}
                    </span>
                  </button>
                ),
              )}
              <div className="w-px py-1 bg-line shrink-0 mx-1" />
              <button
                type="button"
                disabled={bulkWorking}
                onClick={() => void confirmAllWaitlisted()}
                className="shrink-0 inline-flex items-center gap-1 border border-team-a/40 bg-team-a/15 px-3 py-1.5 text-xs font-medium text-team-a hover:bg-team-a/25 disabled:opacity-50 active:scale-[0.97]"
              >
                {bulkWorking ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <UserCheck className="w-3 h-3" />
                )}
                Confirm all
              </button>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filteredAttendees.length === 0 ? (
              <p className="text-center text-sm text-ink-dim py-8">
                No matching players.
              </p>
            ) : (
              filteredAttendees.map((a) => {
                const canMove =
                  a.status === "confirmed" || a.status === "waitlisted";
                const busy =
                  movingKey === `${a.user_id}-confirmed` ||
                  movingKey === `${a.user_id}-waitlisted`;
                const displayName = a.display_name;
                const mmSkill = Math.min(5, Math.max(1, Math.round(a.skill)));
                const primaryPos = formatSpecialty(a.primary_specialty);
                const secondaryPos = formatSpecialty(a.secondary_specialty);
                const posLabel =
                  [primaryPos, secondaryPos].filter(Boolean).join("/") || null;
                return (
                  <div
                    key={a.user_id}
                    className="border border-line bg-panel p-3 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <PlayerAvatarFace
                        name={displayName}
                        avatarUrl={a.avatar_url ?? undefined}
                        size="sm"
                        isPlusOne={a.is_plus_one}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium text-ink truncate">
                            {displayName}
                          </span>
                          {posLabel && (
                            <span className="shrink-0 text-2xs font-medium text-ink-dim bg-raised px-1.5 py-0.5">
                              {posLabel}
                            </span>
                          )}
                          <SkillBadge score={mmSkill} size="sm" />
                          <span
                            className={`shrink-0 px-2 py-0.5 text-2xs font-medium ${
                              a.status === "confirmed"
                                ? "bg-team-a/15 text-team-a"
                                : a.status === "waitlisted"
                                  ? "bg-live/15 text-live"
                                  : "bg-raised text-ink-dim"
                            }`}
                          >
                            {a.status}
                          </span>
                        </div>
                        {a.calculated_skill != null && (
                          <div className="text-2xs text-ink-faint mt-0.5">
                            calc {a.calculated_skill}
                          </div>
                        )}
                      </div>
                      {canMove && (
                        <div className="flex gap-1.5 shrink-0">
                          {a.status !== "confirmed" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void moveUser(a.user_id, "confirmed")
                              }
                              className="min-h-[36px] px-2.5 border border-team-a/40 text-team-a text-xs font-medium bg-team-a/15 hover:bg-team-a/25 disabled:opacity-50"
                            >
                              Confirm
                            </button>
                          )}
                          {a.status !== "waitlisted" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void moveUser(a.user_id, "waitlisted")
                              }
                              className="min-h-[36px] px-2.5 border border-live/40 text-live text-xs font-medium bg-live/15 hover:bg-live/25 disabled:opacity-50"
                            >
                              Waitlist
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block border border-line overflow-hidden bg-panel">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="text-left py-2.5 px-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">
                      Player
                    </th>
                    <th className="text-left py-2.5 px-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">
                      Position
                    </th>
                    <th className="text-left py-2.5 px-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">
                      Status
                    </th>
                    <th className="text-right py-2.5 px-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAttendees.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="py-8 px-4 text-center text-ink-dim"
                      >
                        No matching players.
                      </td>
                    </tr>
                  ) : (
                    filteredAttendees.map((a) => {
                      const canMove =
                        a.status === "confirmed" || a.status === "waitlisted";
                      const busy =
                        movingKey === `${a.user_id}-confirmed` ||
                        movingKey === `${a.user_id}-waitlisted`;
                      const displayName = a.display_name;
                      const mmSkill = Math.min(
                        5,
                        Math.max(1, Math.round(a.skill)),
                      );
                      const primaryPos = formatSpecialty(a.primary_specialty);
                      const secondaryPos = formatSpecialty(
                        a.secondary_specialty,
                      );
                      const posLabel =
                        [primaryPos, secondaryPos].filter(Boolean).join("/") ||
                        "—";
                      return (
                        <tr
                          key={a.user_id}
                          className="border-b border-line last:border-0 hover:bg-raised transition-colors"
                        >
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <PlayerAvatarFace
                                name={displayName}
                                avatarUrl={a.avatar_url ?? undefined}
                                size="sm"
                                isPlusOne={a.is_plus_one}
                              />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-medium text-ink truncate text-sm">
                                    {displayName}
                                  </span>
                                  <SkillBadge score={mmSkill} size="sm" />
                                </div>
                                <div className="text-2xs text-ink-faint">
                                  {a.calculated_skill != null && (
                                    <span>calc {a.calculated_skill}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 align-top">
                            <span className="text-xs text-ink-dim">
                              {posLabel}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 align-top">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 text-2xs font-medium ${
                                a.status === "confirmed"
                                  ? "bg-team-a/15 text-team-a"
                                  : a.status === "waitlisted"
                                    ? "bg-live/15 text-live"
                                    : "bg-raised text-ink-dim"
                              }`}
                            >
                              {a.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right align-top">
                            {canMove ? (
                              <div className="inline-flex flex-wrap justify-end gap-1.5">
                                {a.status !== "confirmed" && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void moveUser(a.user_id, "confirmed")
                                    }
                                    className="inline-flex items-center gap-1 border border-team-a/40 text-team-a px-2.5 py-1.5 text-xs font-medium bg-team-a/15 hover:bg-team-a/25 disabled:opacity-50"
                                  >
                                    <UserCheck className="w-3.5 h-3.5" />
                                    Confirm
                                  </button>
                                )}
                                {a.status !== "waitlisted" && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void moveUser(a.user_id, "waitlisted")
                                    }
                                    className="inline-flex items-center gap-1 border border-live/40 text-live px-2.5 py-1.5 text-xs font-medium bg-live/15 hover:bg-live/25 disabled:opacity-50"
                                  >
                                    <Users className="w-3.5 h-3.5" />
                                    Waitlist
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-ink-faint">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── Teams tab ───────────────────────────────────────────── */}

      {tab === "teams" && (
        <section className="space-y-3">
          {/* Team capacity card */}
          {detail && (
            <div className="border border-line bg-panel p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink">
                    Team capacity
                  </h3>
                  <p className="text-xs text-ink-dim mt-0.5 tabular-nums">
                    {teamsData
                      ? `${teamsData.teams.length} team(s) · ${detail.attendees.filter((a) => a.status === "confirmed").length} confirmed`
                      : "Loading…"}
                    <span className="text-live ml-1">
                      ·{" "}
                      {
                        detail.attendees.filter(
                          (a) => a.status === "waitlisted",
                        ).length
                      }{" "}
                      waitlisted
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={
                      !detail.max_teams ||
                      detail.max_teams <= 2 ||
                      adjustingTeam !== null
                    }
                    onClick={() => void adjustTeams("contract")}
                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-danger/40 text-danger text-xs font-medium bg-danger/15 hover:bg-danger/25 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.97] transition-colors"
                    title="Remove a team (returns players to waitlist)"
                  >
                    {adjustingTeam === "contract" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Minus className="w-3.5 h-3.5" />
                    )}
                    Remove
                  </button>
                  <button
                    type="button"
                    disabled={
                      detail.attendees.filter((a) => a.status === "waitlisted")
                        .length === 0 || adjustingTeam !== null
                    }
                    onClick={() => void adjustTeams("expand")}
                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-team-a/40 text-team-a text-xs font-medium bg-team-a/15 hover:bg-team-a/25 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.97] transition-colors"
                    title="Add a team (promotes players from waitlist)"
                  >
                    {adjustingTeam === "expand" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    Add
                  </button>
                </div>
              </div>
              {detail.attendees.filter((a) => a.status === "waitlisted")
                .length > 0 &&
                detail.attendees.filter((a) => a.status === "waitlisted")
                  .length < 5 && (
                  <p className="text-2xs text-ink-faint mt-2">
                    Only{" "}
                    {
                      detail.attendees.filter((a) => a.status === "waitlisted")
                        .length
                    }{" "}
                    waitlisted player(s) — adding a team will create a partial
                    team.
                  </p>
                )}
              {!detail.max_teams && (
                <p className="text-2xs text-ink-faint mt-2">
                  Team count is automatic. Adding a team sets an explicit cap.
                </p>
              )}
            </div>
          )}

          {teamsLoading ? (
            <div className="flex justify-center py-12 text-ink-dim">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : !teamsData || teamsData.teams.length === 0 ? (
            <div className="border border-dashed border-line p-8 text-center">
              <LayoutGrid className="w-8 h-8 mx-auto text-ink-faint mb-2" />
              <p className="text-sm text-ink-dim">
                No team assignments yet — players need to join and teams must be
                formed.
              </p>
            </div>
          ) : (
            <DraggableTeams
              meetup={teamMeetup ?? { id: String(id), date: "", attendance: [], teams: [] }}
              onMovePlayer={handleMovePlayer}
              onToggleLock={handleToggleLock}
              canDragTeams={Boolean(teamMeetup)}
            />
          )}
        </section>
      )}

      {/* ── Scores tab ──────────────────────────────────────────── */}

      {tab === "scores" && (
        <section className="space-y-3">
          <MatchHistoryList meetupId={id} editable />
        </section>
      )}

      {/* Footer */}
      <footer className="text-2xs text-ink-faint border-t border-line pt-4">
        Data revision #{detail.content_revision}
      </footer>
    </div>
  );
}
