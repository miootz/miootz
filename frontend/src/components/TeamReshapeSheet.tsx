import { useEffect, useId, useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { reshapeMeetupTeams, type TeamsResponse } from "../api/meetupsApi";
import { useToast } from "../context/ToastContext";

/**
 * Admin team reshape: pick the team count and players per side.
 * N×M players form the playing teams
 * (skill-balanced); everyone else goes to ONE bench team — there is no
 * "not on a team" category. Fine-tune the lineup afterwards with the
 * pre-start substitutions panel (two-tap swap).
 */
interface TeamReshapeSheetProps {
  meetupId: number;
  totalPlayers: number;
  teams: TeamsResponse["teams"];
  maxTeams?: number | null;
  liveMatchNumber: number | null;
  onClose: () => void;
  onSaved: (result: TeamsResponse, teamCount: number) => void;
}

const MAX_TEAM_COUNT = 5;
const MIN_TEAM_SIZE = 2;
const MAX_TEAM_SIZE = 15;

export function TeamReshapeSheet({
  meetupId,
  totalPlayers,
  teams,
  maxTeams,
  liveMatchNumber,
  onClose,
  onSaved,
}: TeamReshapeSheetProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { showToast } = useToast();
  const [teamCount, setTeamCount] = useState(() =>
    Math.min(MAX_TEAM_COUNT, Math.max(2, Math.min(teams.length, maxTeams ?? teams.length))),
  );
  const [teamSize, setTeamSize] = useState(() => {
    const playing = teams.slice(0, teamCount).reduce((total, team) => total + team.players.length, 0);
    return Math.min(MAX_TEAM_SIZE, Math.max(MIN_TEAM_SIZE, Math.floor(playing / teamCount)));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capacity = teamCount * teamSize;
  const benchCount = Math.max(0, totalPlayers - capacity);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const reason =
    capacity > totalPlayers
      ? `Need ${capacity} players, ${totalPlayers} confirmed`
      : null;

  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  const apply = async () => {
    if (reason || saving) return;
    setSaving(true);
    setError(null);
    let result: TeamsResponse;
    try {
      result = await reshapeMeetupTeams(meetupId, {
        team_count: teamCount,
        team_size: teamSize,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update teams.");
      return;
    } finally {
      setSaving(false);
    }
    close();
    onSaved(result, teamCount);
    showToast("Teams updated.", "success");
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) close();
      }}
      onClick={(event) => {
        if (!saving && event.target === event.currentTarget) close();
      }}
      className="fixed inset-x-0 top-auto bottom-4 mx-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto overscroll-contain border border-line bg-panel p-0 text-ink shadow-xl backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/50 sm:inset-0 sm:m-auto"
    >
      <div className="p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-bold text-ink">
            Team capacity
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="grid h-11 w-11 place-items-center text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Team count */}
        <div className="mt-5">
          <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
            Teams
          </p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {[2, 3, 4, MAX_TEAM_COUNT].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTeamCount(n)}
                disabled={saving}
                aria-pressed={teamCount === n}
                className={`min-h-[44px] border text-base font-bold tabular-nums transition-colors ${
                  teamCount === n
                    ? "border-live bg-live/10 text-live"
                    : "border-line text-ink-dim hover:bg-raised hover:text-ink"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Players per team */}
        <div className="mt-5">
          <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
            Players per team
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTeamSize(Math.max(MIN_TEAM_SIZE, teamSize - 1))}
              disabled={saving || teamSize <= MIN_TEAM_SIZE}
              className="flex h-11 w-11 items-center justify-center border border-line text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-40 active:scale-[0.98] transition-transform"
              aria-label="Fewer players per team"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[2ch] text-center text-2xl font-extrabold tabular-nums text-ink">
              {teamSize}
            </span>
            <button
              type="button"
              onClick={() => setTeamSize(Math.min(MAX_TEAM_SIZE, teamSize + 1))}
              disabled={saving || teamSize >= MAX_TEAM_SIZE}
              className="flex h-11 w-11 items-center justify-center border border-line text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-40 active:scale-[0.98] transition-transform"
              aria-label="More players per team"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Result line */}
        <p role="status" className="mt-5 border border-line bg-raised px-3 py-2 text-sm font-medium tabular-nums text-ink">
          {Math.min(capacity, totalPlayers)} playing
          {benchCount > 0
            ? ` · ${benchCount} on bench`
            : " · no bench"}
        </p>

        {liveMatchNumber !== null && (
          <p className="mt-3 border border-live/40 bg-live/10 px-3 py-2 text-sm text-ink">
            Match {liveMatchNumber} keeps its current lineup.
          </p>
        )}

        <div className="mt-5">
          {reason && (
            <p className="mb-2 text-center text-sm text-danger">{reason}</p>
          )}
          {error && <p role="alert" className="mb-2 text-center text-sm text-danger">{error}</p>}
          <button
            type="button"
            onClick={() => void apply()}
            disabled={!!reason || saving}
            className="w-full py-3.5 bg-ink text-board text-base font-bold hover:bg-white/90 disabled:opacity-50 active:scale-[0.98] transition-transform min-h-[48px]"
          >
            {saving ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
