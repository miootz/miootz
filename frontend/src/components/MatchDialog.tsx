import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import type { MeetupDetail } from "../api/meetupsApi";
import { fetchMeetupTeams, type TeamsResponse } from "../api/meetupsApi";
import type { MatchSummary } from "../api/matchesApi";
import {
  createMatch,
  fetchMatchSubstitutions,
  type MatchSubstitution,
} from "../api/matchesApi";
import { useToast } from "../context/ToastContext";
import { GoalsSection } from "./GoalsSection";
import { HistoricalLineupForm } from "./HistoricalLineupForm";

interface MatchDialogProps {
  meetupId: number;
  attendees?: MeetupDetail["attendees"];
  /** "add" — create a new match result; "edit" — edit an existing one. */
  mode: "add" | "edit";
  /** Edit mode only — the match being edited. */
  match: MatchSummary | null;
  onClose: () => void;
  /** Add mode: called once the match is created; the dialog stays open. */
  onCreated: (match: MatchSummary) => void;
  onSaved: (matchId: number, updated: Partial<MatchSummary>) => void;
  onDelete: (matchId: number) => void;
}

/**
 * Shared match editor — the single paradigm for adding a match result and
 * editing an existing one. Mobile-first bottom sheet; expands to a centered
 * panel on tablet and desktop.
 *
 * Add mode starts at team picking — once both teams are picked and the match
 * is created, it behaves exactly like edit mode (lineup + goal log).
 * Edit mode: read-only score driven by the goal log, lineup editor, goals.
 */
export function MatchDialog({
  meetupId,
  attendees,
  mode,
  match,
  onClose,
  onCreated,
  onSaved,
  onDelete,
}: MatchDialogProps) {
  const { showToast } = useToast();
  const [teams, setTeams] = useState<TeamsResponse["teams"] | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [createdMatch, setCreatedMatch] = useState<MatchSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (mode !== "add") return;
    let cancelled = false;
    void fetchMeetupTeams(meetupId)
      .then((res) => {
        if (cancelled) return;
        setTeams(res.teams);
        if (res.teams.length > 0) setTeamA(res.teams[0].name);
        if (res.teams.length > 1) setTeamB(res.teams[1].name);
      })
      .catch((e) => {
        if (cancelled) return;
        setTeamsError(e instanceof Error ? e.message : "Failed to load teams");
      });
    return () => {
      cancelled = true;
    };
  }, [meetupId, mode]);

  const activeMatch = mode === "edit" ? match : createdMatch;

  const handleCreate = async () => {
    if (!teamA || !teamB || teamA.trim().toLowerCase() === teamB.trim().toLowerCase()) {
      showToast("Pick two different teams first.", "error");
      return;
    }
    setCreating(true);
    try {
      const res = await createMatch(meetupId, {
        team_a_name: teamA.trim(),
        team_b_name: teamB.trim(),
        score_a: 0,
        score_b: 0,
      });
      setCreatedMatch(res.match);
      onCreated(res.match);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to create the match", "error");
    } finally {
      setCreating(false);
    }
  };

  const handleSaved = (updated: Partial<MatchSummary>) => {
    if (!activeMatch) return;
    if (mode === "add") {
      setCreatedMatch((prev) => (prev ? { ...prev, ...updated } : prev));
    }
    onSaved(activeMatch.id, updated);
  };

  const title =
    mode === "edit" || createdMatch
      ? `Edit match ${activeMatch ? `#${activeMatch.match_number}` : ""}`
      : "Add match result";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={mode === "add" && !createdMatch ? "Add match result" : "Edit match"}
    >
      <div className="flex max-h-[94dvh] w-full flex-col border border-line bg-panel shadow-xl sm:max-h-[88vh] sm:max-w-lg">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center text-ink-dim hover:bg-raised hover:text-ink"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {activeMatch ? (
            <EditMatchBody
              meetupId={meetupId}
              attendees={attendees ?? []}
              match={activeMatch}
              onSaved={handleSaved}
            />
          ) : (
            <AddMatchBody
              teams={teams}
              teamsError={teamsError}
              teamA={teamA}
              teamB={teamB}
              onTeamA={setTeamA}
              onTeamB={setTeamB}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
          {activeMatch ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (confirmDelete) onDelete(activeMatch.id);
                  else setConfirmDelete(true);
                }}
                className="flex items-center gap-1.5 border border-danger/40 px-3 py-3 text-sm font-semibold text-danger hover:bg-danger/10 active:scale-[0.98]"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                {confirmDelete ? "Confirm delete" : "Delete"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-ink text-sm font-bold text-board hover:bg-white/90 active:scale-[0.98]"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 border border-line text-sm font-semibold text-ink-dim hover:bg-raised hover:text-ink active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creating || !teams || teams.length < 2 || !teamA || !teamB || !!teamsError}
                onClick={() => void handleCreate()}
                className="flex flex-1 items-center justify-center gap-1.5 bg-ink px-4 py-3 text-sm font-bold text-board hover:bg-white/90 disabled:opacity-50 active:scale-[0.98]"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden />
                )}
                Create match
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add-mode body (team picking) ────────────────────────────────────

function AddMatchBody({
  teams,
  teamsError,
  teamA,
  teamB,
  onTeamA,
  onTeamB,
}: {
  teams: TeamsResponse["teams"] | null;
  teamsError: string | null;
  teamA: string;
  teamB: string;
  onTeamA: (v: string) => void;
  onTeamB: (v: string) => void;
}) {
  const list = teams ?? [];
  return (
    <div className="space-y-4">
      {teamsError && <p role="alert" className="text-sm text-danger">{teamsError}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label
            htmlFor="dialog-team-a"
            className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim"
          >
            Team A
          </label>
          <select
            id="dialog-team-a"
            value={teamA}
            onChange={(e) => onTeamA(e.target.value)}
            className="w-full appearance-none border border-line bg-raised px-3 py-2.5 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
          >
            {list.map((t) => (
              <option key={t.id} value={t.name} disabled={t.name === teamB}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="dialog-team-b"
            className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim"
          >
            Team B
          </label>
          <select
            id="dialog-team-b"
            value={teamB}
            onChange={(e) => onTeamB(e.target.value)}
            className="w-full appearance-none border border-line bg-raised px-3 py-2.5 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
          >
            {list.map((t) => (
              <option key={t.id} value={t.name} disabled={t.name === teamA}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {teams === null && !teamsError && (
        <p role="status" className="flex items-center justify-center gap-2 py-2 text-sm text-ink-dim">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading teams…
        </p>
      )}
      {teams && teams.length >= 2 && (
        <p className="text-sm text-ink-dim">
          Pick both teams, then create the match — you can edit the lineups and log goals once the
          match is created.
        </p>
      )}
    </div>
  );
}

// ── Edit-mode body ───────────────────────────────────────────────────

function EditMatchBody({
  meetupId,
  attendees,
  match,
  onSaved,
}: {
  meetupId: number;
  attendees?: MeetupDetail["attendees"];
  match: MatchSummary;
  onSaved: (updated: Partial<MatchSummary>) => void;
}) {
  const [loaded, setLoaded] = useState<{ id: number; subs: MatchSubstitution[] } | null>(null);
  const [loadErrorId, setLoadErrorId] = useState<number | null>(null);
  const [lineupOpen, setLineupOpen] = useState(true);

  const matchId = match.id;
  useEffect(() => {
    let cancelled = false;
    fetchMatchSubstitutions(meetupId, matchId)
      .then((res) => {
        if (!cancelled) setLoaded({ id: matchId, subs: res.substitutions });
      })
      .catch(() => {
        if (!cancelled) setLoadErrorId(matchId);
      });
    return () => {
      cancelled = true;
    };
  }, [meetupId, matchId]);

  const subs = loaded?.id === matchId ? loaded.subs : null;
  const loadError = loadErrorId === matchId;

  const teamA = match.team_a;
  const teamB = match.team_b;

  return (
    <div className="space-y-5">
      {/* Score — driven by the goal log */}
      <div className="flex items-center justify-center gap-3">
        <span className="text-3xl font-extrabold tabular-nums text-team-a">
          {match.score_a}
        </span>
        <span className="text-xl font-bold text-ink-faint">–</span>
        <span className="text-3xl font-extrabold tabular-nums text-team-b">
          {match.score_b}
        </span>
      </div>

      {/* Team panels — who played */}
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            [teamA, "bg-team-a"],
            [teamB, "bg-team-b"],
          ] as const
        ).map(([team, slab]) => (
          <div key={team.name} className="min-w-0">
            <p className={`${slab} px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-white truncate`}>
              {team.name} · {team.users.length}
            </p>
            <ul className="mt-1 space-y-0.5">
              {team.users.map((u) => (
                <li key={u.id} className="truncate text-sm text-ink-dim">
                  {u.display_name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Lineup editor */}
      {lineupOpen ? (
        subs === null && !loadError ? (
          <p className="flex items-center justify-center gap-2 py-2 text-sm text-ink-dim">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading lineup…
          </p>
        ) : loadError ? (
          <p role="alert" className="text-sm text-danger">
            Couldn’t load substitutions.
          </p>
        ) : (
          <HistoricalLineupForm
            meetupId={meetupId}
            match={match}
            substitutions={subs ?? []}
            attendees={attendees ?? []}
            onSaved={(updated, newSubs) => {
              onSaved(updated);
              setLoaded({ id: matchId, subs: newSubs });
            }}
            onCancel={() => setLineupOpen(false)}
          />
        )
      ) : (
        <button
          type="button"
          onClick={() => setLineupOpen(true)}
          className="min-h-12 w-full border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-raised"
        >
          Edit lineup
        </button>
      )}

      {/* Goals */}
      <GoalsSection meetupId={meetupId} match={match} onScoreSaved={onSaved} />
    </div>
  );
}
