import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutGrid, Loader2, Minus, Plus } from "lucide-react";
import type { Meetup, Team, User } from "../types";
import {
  fetchMeetupTeams,
  patchMeetupTeams,
  type MeetupDetail,
  type TeamsResponse,
} from "../api/meetupsApi";
import { adminAdjustTeams, adminReshuffleTeams } from "../api/adminApi";
import { useToast } from "../context/ToastContext";
import { hapticLight } from "../utils/haptics";
import { DraggableTeams } from "./DraggableTeams";

function ratingOf(p: User): number {
  return p.calculatedSkill != null
    ? p.calculatedSkill
    : Math.round(p.skillScore);
}

/** Display order: rating desc, name (first letter) asc on ties. */
function sortedPlayers(players: User[]): User[] {
  return [...players].sort(
    (a, b) => ratingOf(b) - ratingOf(a) || a.name.localeCompare(b.name),
  );
}

function mapTeamPlayers(team: TeamsResponse["teams"][0]): User[] {
  return sortedPlayers(
    team.players.map((p) => ({
      id: p.id,
      name: p.name,
      skillScore: p.skillScore,
      isLocked: p.isLocked,
      avatarUrl: p.profilePic ?? undefined,
      primarySpecialty: p.primarySpecialty ?? undefined,
      secondarySpecialty: p.secondarySpecialty ?? undefined,
      calculatedSkill: p.calculatedSkill ?? null,
      pac: p.pac,
      dri: p.dri,
    })),
  );
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
      pac: a.pac,
      dri: a.dri,
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

export function MeetupTeamsPanel({
  meetupId,
  detail,
  onChanged,
  live,
}: {
  meetupId: number;
  detail: MeetupDetail;
  /** Parent refetch hook — called after every successful write. */
  onChanged: () => void | Promise<void>;
  /** SSE subscription state, shown in the section header. */
  live?: boolean;
}) {
  const { showToast } = useToast();
  const [teams, setTeams] = useState<TeamsResponse | null>(null);
  const [teamMeetup, setTeamMeetup] = useState<Meetup | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [adjustingTeam, setAdjustingTeam] = useState<
    "expand" | "contract" | null
  >(null);
  const [reshuffling, setReshuffling] = useState(false);
  // Locks are client-side only (no server field); keep them across refetches
  // so reshuffles and SSE-driven refreshes don't cancel them.
  const lockedIdsRef = useRef<Set<string>>(new Set());

  const waitlistedCount = detail.attendees.filter(
    (a) => a.status === "waitlisted",
  ).length;
  // Capacity controls are a progressive-disclosure detail; stats stay
  // visible. Auto-expand only when the waitlist can fill a whole extra
  // team (5 players) — that is when adding a team is actually on the table.
  const [capOpen, setCapOpen] = useState(() => waitlistedCount >= 5);

  // Re-apply client-side locks onto a freshly built lineup (server payload
  // never carries them), so refetches never cancel an existing lock.
  const withLocalLocks = useCallback(
    (built: Meetup | null): Meetup | null => {
      if (!built) return null;
      return {
        ...built,
        attendance: built.attendance.map((u) =>
          lockedIdsRef.current.has(u.id) ? { ...u, isLocked: true } : u,
        ),
      };
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setTeamsLoading(true);
    void fetchMeetupTeams(meetupId)
      .then((t) => {
        if (cancelled) return;
        setTeams(t);
        setTeamMeetup(withLocalLocks(buildTeamMeetup(detail, t, meetupId)));
      })
      .catch(() => {
        if (!cancelled) setTeams(null);
      })
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetupId, detail.content_revision]);

  async function adjustTeams(op: "expand" | "contract") {
    setAdjustingTeam(op);
    try {
      const result = await adminAdjustTeams(meetupId, op, 1);
      await onChanged();
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
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Adjustment failed", "error");
    } finally {
      setAdjustingTeam(null);
    }
  }

  async function reshuffleTeams() {
    setReshuffling(true);
    try {
      // Send the current lineup + locked ids so locked players keep their
      // spots and only the rest is rebalanced (backend handles both modes).
      const body = teamMeetup
        ? {
            teams: teamMeetup.teams.map((t) => t.players.map((p) => p.id)),
            locked: teamMeetup.attendance
              .filter((u) => u.isLocked)
              .map((u) => u.id),
          }
        : undefined;
      const res = await adminReshuffleTeams(meetupId, body);
      if (res.status === "already_balanced") {
        showToast("Already balanced — nothing to reshuffle.");
      } else {
        await onChanged();
        showToast("Teams reshuffled.", "success");
        hapticLight();
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Reshuffle failed", "error");
    } finally {
      setReshuffling(false);
    }
  }

  const handleToggleLock = useCallback((userId: string) => {
    setTeamMeetup((m) => {
      if (!m) return m;
      const next = new Set(lockedIdsRef.current);
      const nowLocked = !m.attendance.find((u) => u.id === userId)?.isLocked;
      if (nowLocked) next.add(userId);
      else next.delete(userId);
      lockedIdsRef.current = next;
      const attendance = m.attendance.map((u) =>
        u.id === userId ? { ...u, isLocked: nowLocked } : u,
      );
      return {
        ...m,
        attendance,
        teams: m.teams,
      };
    });
  }, []);

  const handleMovePlayer = useCallback(
    async (playerId: string, sourceTeamId: string, destTeamId: string) => {
      if (!teamMeetup) return;
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
        const res = await patchMeetupTeams(meetupId, payload);
        setTeams(res);
        setTeamMeetup(withLocalLocks(buildTeamMeetup(detail, res, meetupId)));
        void onChanged();
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : "Could not save team lineup",
          "error",
        );
        void onChanged();
      }
    },
    [meetupId, teamMeetup, detail, onChanged, showToast, withLocalLocks],
  );

  return (
    <section className="border border-line bg-panel overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-line">
        <LayoutGrid className="w-4 h-4 text-ink-faint" aria-hidden />
        <h2 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink">
          Teams
        </h2>
        {live !== undefined && (
          <span
            className={`inline-flex items-center gap-1.5 text-2xs font-medium ${
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
        )}
      </header>

      <div className="space-y-3 p-4">
        {/* Team capacity — header + stats always visible; buttons and notes
            collapse in an accordion */}
        <div>
          <button
            type="button"
            onClick={() => setCapOpen((o) => !o)}
            aria-expanded={capOpen}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-raised transition-colors"
          >
            <span className="min-w-0">
              <span className="block text-2xs font-bold uppercase tracking-[0.14em] text-ink">
                Team capacity
              </span>
              <span className="block text-xs text-ink-dim mt-0.5 tabular-nums">
                {teams
                  ? `${teams.teams.length} team(s) · ${detail.attendees.filter((a) => a.status === "confirmed").length} confirmed`
                  : "Loading…"}
                <span className="text-live ml-1">
                  · {waitlistedCount} waitlisted
                </span>
              </span>
            </span>
            <ChevronDown
              className={`w-4 h-4 shrink-0 text-ink-faint transition-transform motion-reduce:transition-none ${capOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {capOpen && (
            <div className="border-t border-line p-4 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={
                    !detail.max_teams ||
                    detail.max_teams <= 2 ||
                    adjustingTeam !== null
                  }
                  onClick={() => void adjustTeams("contract")}
                  className="inline-flex min-h-[44px] items-center gap-1 px-3 py-1.5 border border-danger/40 text-danger text-xs font-medium bg-danger/15 hover:bg-danger/25 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.97] transition-colors"
                  title="Remove a team (returns players to waitlist)"
                >
                  {adjustingTeam === "contract" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Minus className="w-3.5 h-3.5" />
                  )}
                  Remove team
                </button>
                <button
                  type="button"
                  disabled={waitlistedCount === 0 || adjustingTeam !== null}
                  onClick={() => void adjustTeams("expand")}
                  className="inline-flex min-h-[44px] items-center gap-1 px-3 py-1.5 border border-team-a/40 text-team-a text-xs font-medium bg-team-a/15 hover:bg-team-a/25 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.97] transition-colors"
                  title="Add a team (promotes players from waitlist)"
                >
                  {adjustingTeam === "expand" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  Add team
                </button>
              </div>
              {waitlistedCount > 0 && waitlistedCount < 5 && (
                <p className="text-2xs text-ink-faint">
                  Only {waitlistedCount} waitlisted player(s) — adding a team
                  will create a partial team.
                </p>
              )}
              {!detail.max_teams && (
                <p className="text-2xs text-ink-faint">
                  Team count is automatic. Adding a team sets an explicit cap.
                </p>
              )}
            </div>
          )}
        </div>

        {teamsLoading ? (
          <div className="flex justify-center py-12 text-ink-dim">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : !teams || teams.teams.length === 0 ? (
          <div className="border border-dashed border-line p-8 text-center">
            <LayoutGrid className="w-8 h-8 mx-auto text-ink-faint mb-2" />
            <p className="text-sm text-ink-dim">
              No team assignments yet — players need to join and teams must be
              formed.
            </p>
          </div>
        ) : (
          <DraggableTeams
            meetup={
              teamMeetup ?? { id: String(meetupId), date: "", attendance: [], teams: [] }
            }
            onMovePlayer={handleMovePlayer}
            onToggleLock={handleToggleLock}
            canDragTeams={Boolean(teamMeetup)}
            onReshuffle={() => void reshuffleTeams()}
            reshuffling={reshuffling}
          />
        )}
      </div>
    </section>
  );
}
