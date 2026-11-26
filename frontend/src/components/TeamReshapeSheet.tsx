import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { Minus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { reshapeMeetupTeams, type TeamsResponse } from "../api/meetupsApi";
import { useToast } from "../context/ToastContext";
import { matchControlWindow } from "../utils/datetime";

interface TeamReshapeSheetProps {
  meetupId: number;
  totalPlayers: number;
  waitlistedPlayers: number;
  teams: TeamsResponse["teams"];
  maxTeams?: number | null;
  currentTeamSize?: number | null;
  minPlayers: number;
  maxPlayers: number;
  startTime: string;
  hasStarted: boolean;
  liveMatchNumber: number | null;
  onClose: () => void;
  onSaved: (result: TeamsResponse, teamCount: number, signupCapacity: number, teamSize: number) => void;
  /** Reset / delete the live match — confirm dialogs live on the caller. */
  onResetMatch?: () => void;
  onDeleteMatch?: () => void;
}

const MAX_TEAM_COUNT = 5;
const MIN_TEAM_SIZE = 2;
const MAX_TEAM_SIZE = 15;

export function TeamReshapeSheet({
  meetupId,
  totalPlayers,
  waitlistedPlayers,
  teams,
  maxTeams,
  currentTeamSize,
  minPlayers,
  maxPlayers,
  startTime,
  hasStarted,
  liveMatchNumber,
  onClose,
  onSaved,
  onResetMatch,
  onDeleteMatch,
}: TeamReshapeSheetProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const { showToast } = useToast();
  const { opensAt } = matchControlWindow(startTime);
  const [clock, setClock] = useState(Date.now);
  const preserveConfirmed = hasStarted || clock >= opensAt;
  useEffect(() => {
    if (preserveConfirmed || !Number.isFinite(opensAt)) return;
    // Schedule the next check even when capacity is opened days before kickoff.
    const timeout = window.setTimeout(() => setClock(Date.now()), Math.min(
      Math.max(1, opensAt - Date.now()), 2_147_483_647,
    ));
    return () => window.clearTimeout(timeout);
  }, [clock, opensAt, preserveConfirmed]);

  const [teamCount, setTeamCount] = useState(() =>
    Math.min(MAX_TEAM_COUNT, Math.max(2, maxTeams ?? teams.length)),
  );
  const [teamSize, setTeamSize] = useState(() => {
    const playing = teams.slice(0, teamCount).reduce((total, team) => total + team.players.length, 0);
    const size = currentTeamSize ?? (preserveConfirmed && playing > 0 ? Math.ceil(playing / teamCount) : Math.ceil(maxPlayers / teamCount));
    return Math.min(MAX_TEAM_SIZE, Math.max(MIN_TEAM_SIZE, size));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capacity = teamCount * teamSize;
  const signupCapacity = preserveConfirmed ? Math.max(minPlayers, Math.min(capacity, 50)) : capacity;
  const promoted = Math.min(waitlistedPlayers, Math.max(0, signupCapacity - totalPlayers));
  const returned = preserveConfirmed ? 0 : Math.max(0, totalPlayers - signupCapacity);
  const confirmed = totalPlayers + promoted - returned;
  const benchCount = Math.max(0, confirmed - capacity);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const reason = !preserveConfirmed && (capacity < minPlayers || capacity > 50)
    ? `Signup capacity must be between ${minPlayers} and 50 players.`
    : null;

  const isOutside = (event: PointerEvent<HTMLDialogElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
  };

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
    onSaved(result, teamCount, signupCapacity, teamSize);
    showToast("Capacity updated.", "success");
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) close();
      }}
      onPointerDown={(event) => { pressedOutside.current = isOutside(event); }}
      onPointerUp={(event) => {
        if (!saving && pressedOutside.current && isOutside(event)) close();
      }}
      className="fixed inset-x-0 top-auto bottom-4 mx-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto overscroll-contain border border-line bg-panel p-0 text-ink shadow-xl backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/50 sm:inset-0 sm:m-auto tablet:max-w-[38rem] desktop:max-w-[44rem]"
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

        <div className="tablet:grid tablet:grid-cols-[minmax(0,1fr)_auto] tablet:gap-7">
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
                  autoFocus={teamCount === n}
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

        </div>

        {/* Result line */}
        <p role="status" className="mt-5 border border-line bg-raised px-3 py-2 text-sm font-medium tabular-nums text-ink">
          {signupCapacity} signup places · {confirmed} confirmed · {waitlistedPlayers - promoted + returned} waitlisted
          {benchCount > 0 && ` · ${benchCount} on bench`}
        </p>

        {promoted > 0 && <p className="mt-2 text-sm text-ink-dim">{promoted} earliest waitlisted {promoted === 1 ? "player will" : "players will"} be confirmed.</p>}
        {returned > 0 && <p className="mt-2 text-sm text-ink-dim">{returned} most recent {returned === 1 ? "signup will" : "signups will"} return to the waitlist.</p>}
        {benchCount > 0 && <p className="mt-2 text-sm text-ink-dim">Bench players stay confirmed and are available in Substitutions when off the pitch.</p>}
        {confirmed < capacity && <p className="mt-2 text-sm text-ink-dim">Teams will have open places until more players join.</p>}
        {preserveConfirmed && signupCapacity !== capacity && <p className="mt-2 text-sm text-ink-dim">Signup capacity stays between the meetup minimum and 50 players.</p>}

        {liveMatchNumber !== null && (
          <p className="mt-3 border border-live/40 bg-live/10 px-3 py-2 text-sm text-ink">
            Match {liveMatchNumber} keeps its current lineup.
          </p>
        )}

        <div className="mt-5 tablet:text-right">
          {reason && (
            <p className="mb-2 text-center text-sm text-danger">{reason}</p>
          )}
          {error && <p role="alert" className="mb-2 text-center text-sm text-danger">{error}</p>}
          <button
            type="button"
            onClick={() => void apply()}
            disabled={!!reason || saving}
            className="w-full py-3.5 bg-ink text-board text-base font-bold hover:bg-white/90 disabled:opacity-50 active:scale-[0.98] transition-transform min-h-[48px] tablet:w-auto tablet:min-w-40 tablet:px-6"
          >
            {saving ? "Applying…" : "Apply"}
          </button>
        </div>

        {/* Match actions — the caller confirms and runs these */}
        {(onResetMatch || onDeleteMatch) && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
              Match
            </p>
            <div className="mt-2 flex gap-2">
              {onResetMatch && (
                <button
                  type="button"
                  onClick={onResetMatch}
                  disabled={saving}
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-2 border border-line px-3 py-2.5 text-sm font-semibold text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-40 active:scale-[0.98] transition-transform"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>
              )}
              {onDeleteMatch && (
                <button
                  type="button"
                  onClick={onDeleteMatch}
                  disabled={saving}
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-2 border border-danger/40 px-3 py-2.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-40 active:scale-[0.98] transition-transform"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
