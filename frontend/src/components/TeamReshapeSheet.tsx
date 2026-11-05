import { useEffect, useId, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { reshapeMeetupTeams } from "../api/meetupsApi";

/**
 * Mid-meetup team reshape (admin, from the Match Control gear): pick the
 * team count and players per side. N×M players form the playing teams
 * (skill-balanced); everyone else goes to ONE bench team — there is no
 * "not on a team" category. Fine-tune the lineup afterwards with the
 * pre-start substitutions panel (two-tap swap).
 */
interface TeamReshapeSheetProps {
  open: boolean;
  meetupId: number;
  totalPlayers: number;
  currentTeamCount: number;
  liveMatchNumber: number | null;
  onClose: () => void;
  onSaved: () => void;
}

const MAX_TEAM_COUNT = 5;
const MIN_TEAM_SIZE = 2;
const MAX_TEAM_SIZE = 15;

export function TeamReshapeSheet({
  open,
  meetupId,
  totalPlayers,
  currentTeamCount,
  liveMatchNumber,
  onClose,
  onSaved,
}: TeamReshapeSheetProps) {
  const titleId = useId();
  const [teamCount, setTeamCount] = useState(
    Math.min(Math.max(2, currentTeamCount), MAX_TEAM_COUNT),
  );
  const [teamSize, setTeamSize] = useState(() =>
    Math.max(
      MIN_TEAM_SIZE,
      Math.round(totalPlayers / Math.max(2, currentTeamCount)),
    ),
  );
  const [saving, setSaving] = useState(false);

  const capacity = teamCount * teamSize;
  const benchCount = Math.max(0, totalPlayers - capacity);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const reason =
    capacity > totalPlayers
      ? `Need ${capacity} players, ${totalPlayers} confirmed`
      : null;

  if (!open) return null;

  const apply = async () => {
    if (reason || saving) return;
    setSaving(true);
    try {
      await reshapeMeetupTeams(meetupId, {
        team_count: teamCount,
        team_size: teamSize,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center p-4 sm:items-center sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Dismiss"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md border border-line bg-panel p-6 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-bold text-ink">
            Teams
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-ink-dim hover:bg-raised hover:text-ink active:scale-95 transition-transform"
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
              disabled={teamSize <= MIN_TEAM_SIZE}
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
              disabled={teamSize >= MAX_TEAM_SIZE}
              className="flex h-11 w-11 items-center justify-center border border-line text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-40 active:scale-[0.98] transition-transform"
              aria-label="More players per team"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Result line */}
        <p className="mt-5 border border-line bg-raised px-3 py-2 text-sm font-medium tabular-nums text-ink">
          {Math.min(capacity, totalPlayers)} playing
          {benchCount > 0
            ? ` · ${benchCount} on bench`
            : " · no bench"}
        </p>

        {liveMatchNumber !== null && (
          <p className="mt-3 border border-live/40 bg-live/10 px-3 py-2 text-sm text-ink">
            Match {liveMatchNumber} is live — it keeps its lineup.
          </p>
        )}

        <div className="mt-5">
          {reason && (
            <p className="mb-2 text-center text-sm text-danger">{reason}</p>
          )}
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
    </div>
  );
}
