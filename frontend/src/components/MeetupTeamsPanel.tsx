import { useCallback, useEffect, useState } from "react";
import { LayoutGrid, Loader2, Minus, Plus, Shuffle } from "lucide-react";
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
import { rebalanceTeams } from "../services/teamService";

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

  const waitlistedCount = detail.attendees.filter(
    (a) => a.status === "waitlisted",
  ).length;
  const hasLocked = teamMeetup
    ? teamMeetup.attendance.some((u) => u.isLocked)
    : false;
  const showReshuffle =
    detail.team_assignment_mode === "random" || hasLocked;

  useEffect(() => {
    let cancelled = false;
    setTeamsLoading(true);
    void fetchMeetupTeams(meetupId)
      .then((t) => {
        if (cancelled) return;
        setTeams(t);
        setTeamMeetup(buildTeamMeetup(detail, t, meetupId));
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
      await adminReshuffleTeams(meetupId, body);
      await onChanged();
      showToast("Teams reshuffled.", "success");
      hapticLight();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Reshuffle failed", "error");
    } finally {
      setReshuffling(false);
    }
  }

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
        setTeamMeetup(buildTeamMeetup(detail, res, meetupId));
        void onChanged();
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : "Could not save team lineup",
          "error",
        );
        void onChanged();
      }
    },
    [meetupId, teamMeetup, detail, onChanged, showToast],
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
        {showReshuffle && (
          <button
            type="button"
            disabled={reshuffling}
            onClick={() => void reshuffleTeams()}
            className="ml-auto inline-flex items-center gap-1.5 min-h-[36px] px-2.5 border border-line text-ink-dim hover:bg-raised hover:text-ink text-xs font-medium disabled:opacity-60 transition-colors active:scale-[0.97]"
          >
            {reshuffling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Shuffle className="w-3.5 h-3.5" />
            )}
            Reshuffle
          </button>
        )}
      </header>

      <div className="space-y-3 p-4">
        {/* Team capacity */}
        <div className="border border-line bg-panel p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink">
                Team capacity
              </h3>
              <p className="text-xs text-ink-dim mt-0.5 tabular-nums">
                {teams
                  ? `${teams.teams.length} team(s) · ${detail.attendees.filter((a) => a.status === "confirmed").length} confirmed`
                  : "Loading…"}
                <span className="text-live ml-1">
                  · {waitlistedCount} waitlisted
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
                Remove team
              </button>
              <button
                type="button"
                disabled={waitlistedCount === 0 || adjustingTeam !== null}
                onClick={() => void adjustTeams("expand")}
                className="inline-flex items-center gap-1 px-3 py-1.5 border border-team-a/40 text-team-a text-xs font-medium bg-team-a/15 hover:bg-team-a/25 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.97] transition-colors"
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
          </div>
          {waitlistedCount > 0 && waitlistedCount < 5 && (
            <p className="text-2xs text-ink-faint mt-2">
              Only {waitlistedCount} waitlisted player(s) — adding a team will
              create a partial team.
            </p>
          )}
          {!detail.max_teams && (
            <p className="text-2xs text-ink-faint mt-2">
              Team count is automatic. Adding a team sets an explicit cap.
            </p>
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
            onReshuffle={showReshuffle ? () => void reshuffleTeams() : undefined}
            reshuffling={reshuffling}
          />
        )}
      </div>
    </section>
  );
}
