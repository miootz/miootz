import { parseMeetupStart } from "../utils/datetime";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  createMatch,
  deleteMatch,
  fetchMeetupMatches,
  setScores,
  type MatchSummary,
} from "../api/matchesApi";
import { Flag, Loader2, Plus, Trash2, Trophy } from "lucide-react";
import { AuthContext } from "../auth/auth-context";
import { useToast } from "../context/ToastContext";

export function MatchHistoryList({
  meetupId,
  editable = false,
}: {
  meetupId: number;
  /** When true, scores are clickable and editable by admins. */
  editable?: boolean;
}) {
  const { showToast } = useToast();
  const auth = useContext(AuthContext);
  const isAdmin = auth?.me?.is_admin ?? false;
  const canEdit = editable && isAdmin;

  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchMeetupMatches(meetupId);
      setMatches(res.matches.filter((m) => m.status === "completed"));
    } catch {
      setMatches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetupId]);

  const handleScoreSubmit = async (
    match: MatchSummary,
    scoreA: string,
    scoreB: string,
  ) => {
    const numA = parseInt(scoreA, 10);
    const numB = parseInt(scoreB, 10);
    if (isNaN(numA) || numA < 0 || isNaN(numB) || numB < 0) {
      setEditingId(null);
      return;
    }
    const newScoreA = numA;
    const newScoreB = numB;

    // Optimistic update
    setMatches((prev) =>
      prev.map((m) =>
        m.id === match.id
          ? { ...m, score_a: newScoreA, score_b: newScoreB }
          : m,
      ),
    );
    setEditingId(null);

    try {
      await setScores(meetupId, match.id, newScoreA, newScoreB);
    } catch (e) {
      // Revert on failure
      setMatches((prev) =>
        prev.map((m) =>
          m.id === match.id
            ? { ...m, score_a: match.score_a, score_b: match.score_b }
            : m,
        ),
      );
      showToast(
        e instanceof Error ? e.message : "Failed to update score",
        "error",
      );
    }
  };

  const handleDeleteMatch = async (matchId: number) => {
    try {
      await deleteMatch(meetupId, matchId);
      setMatches((prev) => prev.filter((m) => m.id !== matchId));
      setEditingId(null);
      showToast("Match deleted", "success");
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Failed to delete match",
        "error",
      );
    }
  };

  const handleAddMatch = async (
    teamA: string,
    teamB: string,
    scoreA: number,
    scoreB: number,
  ) => {
    try {
      const res = await createMatch(meetupId, {
        team_a_name: teamA.trim(),
        team_b_name: teamB.trim(),
        score_a: scoreA,
        score_b: scoreB,
      });
      // Add the new match to the list (it's completed)
      setMatches((prev) => [...prev, res.match]);
      setShowAddForm(false);
      showToast("Match added.", "success");
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Failed to add match",
        "error",
      );
    }
  };

  // Collect unique team names from existing matches for dropdown options
  const teamNames = useMemo(() => {
    const names = new Set<string>();
    for (const m of matches) {
      names.add(m.team_a.name);
      names.add(m.team_b.name);
    }
    return Array.from(names).sort();
  }, [matches]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-sm text-ink-dim">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading matches…
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="border border-dashed border-line p-6 text-center">
        <Trophy className="w-6 h-6 mx-auto text-ink-faint mb-1.5" />
        <p className="text-sm text-ink-dim">
          No match results recorded yet.
        </p>
      </div>
    );
  }

  const finalMatch = matches[matches.length - 1];
  const finalResultText = `${finalMatch.team_a.name} ${finalMatch.score_a} – ${finalMatch.score_b} ${finalMatch.team_b.name}`;

  return (
    <div className="space-y-3">
      {/* Add match form */}
      {canEdit && (
        <AddMatchForm
          teamNames={teamNames}
          isOpen={showAddForm}
          onToggle={() => setShowAddForm((v) => !v)}
          onSubmit={handleAddMatch}
        />
      )}

      {matches.length > 1 && (
        <div className="flex items-center gap-2 text-sm font-medium text-ink px-1">
          <Flag className="h-4 w-4" aria-hidden />
          <span className="tabular-nums">Final match: {finalResultText}</span>
        </div>
      )}
      <div className="space-y-2">
        {matches.map((m) => (
          <MatchResultRow
            key={m.id}
            match={m}
            canEdit={canEdit}
            editingId={editingId}
            onEditStart={() => setEditingId(m.id)}
            onEditCancel={() => setEditingId(null)}
            onEditSubmit={handleScoreSubmit}
            onDelete={() => void handleDeleteMatch(m.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Single match row ───────────────────────────────────────────────

function MatchResultRow({
  match,
  canEdit,
  editingId,
  onEditStart,
  onEditCancel,
  onEditSubmit,
  onDelete,
}: {
  match: MatchSummary;
  canEdit: boolean;
  editingId: number | null;
  onEditStart: () => void;
  onEditCancel: () => void;
  onEditSubmit: (match: MatchSummary, scoreA: string, scoreB: string) => void;
  onDelete: () => void;
}) {
  const winner =
    match.score_a > match.score_b
      ? "a"
      : match.score_b > match.score_a
        ? "b"
        : null;
  const isEditing = editingId === match.id;

  const timeLabel = (() => {
    if (!match.completed_at) return null;
    const d = parseMeetupStart(match.completed_at);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  })();

  return (
    <div
      className={`border border-line overflow-hidden ${
        winner ? "bg-raised" : "bg-panel"
      }`}
    >
      {/* Match header */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-board border-b border-line">
        <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim tabular-nums">
          Match {match.match_number}
        </span>
        {timeLabel && (
          <>
            <span className="text-ink-faint">·</span>
            <span className="text-2xs text-ink-dim tabular-nums">
              {timeLabel}
            </span>
          </>
        )}
      </div>
      <div className="px-4 py-3 flex flex-col gap-2">
        {/* Score row */}
        <div className="flex items-center gap-3">
          {/* Team A */}
          <div className="flex-1 min-w-0 text-right">
            <span className="text-sm font-semibold truncate block text-team-a">
              {match.team_a.name}
            </span>
          </div>

          {/* Score */}
          <div className="flex items-center gap-2 shrink-0">
            {isEditing ? (
              <EditableScore
                value={match.score_a}
                matchId={match.id}
                isEditing
              />
            ) : (
              <button
                type="button"
                onClick={
                  canEdit
                    ? (e) => {
                        e.stopPropagation();
                        onEditStart();
                      }
                    : undefined
                }
                className={`text-2xl font-bold tabular-nums min-w-[2ch] text-center transition-colors ${
                  canEdit
                    ? "cursor-pointer text-ink hover:text-live"
                    : "cursor-default text-ink"
                }`}
              >
                {match.score_a}
              </button>
            )}
            <span className="text-ink-faint text-lg font-bold select-none">
              :
            </span>
            {isEditing ? (
              <EditableScore
                value={match.score_b}
                matchId={match.id}
                isEditing
              />
            ) : (
              <button
                type="button"
                onClick={
                  canEdit
                    ? (e) => {
                        e.stopPropagation();
                        onEditStart();
                      }
                    : undefined
                }
                className={`text-2xl font-bold tabular-nums min-w-[2ch] text-center transition-colors ${
                  canEdit
                    ? "cursor-pointer text-ink hover:text-live"
                    : "cursor-default text-ink"
                }`}
              >
                {match.score_b}
              </button>
            )}
          </div>

          {/* Team B */}
          <div className="flex-1 min-w-0 text-left">
            <span className="text-sm font-semibold truncate block text-team-b">
              {match.team_b.name}
            </span>
          </div>
        </div>

        {/* Save / Cancel / Delete buttons — centered below score */}
        {isEditing && (
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-danger/40 text-danger text-xs font-medium hover:bg-danger/10 active:scale-95 transition-colors min-h-[32px]"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
            <button
              type="button"
              onClick={() => {
                const inputs = document.querySelectorAll<HTMLInputElement>(
                  `input[data-match-edit="${match.id}"]`,
                );
                const scoreA = inputs[0]?.value ?? String(match.score_a);
                const scoreB = inputs[1]?.value ?? String(match.score_b);
                onEditSubmit(match, scoreA, scoreB);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-ink text-board text-xs font-bold hover:bg-white/90 active:scale-95 transition-colors min-h-[32px]"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path
                  d="M13.5 4.5L6 12L2.5 8.5"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Save
            </button>
            <button
              type="button"
              onClick={onEditCancel}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-line text-ink-dim text-xs font-medium hover:bg-raised hover:text-ink active:scale-95 transition-colors min-h-[32px]"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Editable score number ──────────────────────────────────────────

function EditableScore({
  value,
  matchId,
  isEditing,
}: {
  value: number;
  matchId: number;
  isEditing: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  if (!isEditing) {
    return null;
  }

  return (
    <input
      ref={inputRef}
      type="number"
      inputMode="numeric"
      min={0}
      defaultValue={value}
      data-match-edit={matchId}
      className="w-12 text-2xl font-bold tabular-nums text-center border-2 border-live bg-raised text-ink outline-hidden"
    />
  );
}

// ── Add match form ─────────────────────────────────────────────────

function AddMatchForm({
  teamNames,
  isOpen,
  onToggle,
  onSubmit,
}: {
  teamNames: string[];
  isOpen: boolean;
  onToggle: () => void;
  onSubmit: (
    teamA: string,
    teamB: string,
    scoreA: number,
    scoreB: number,
  ) => void;
}) {
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed defaults from first two team names
  useEffect(() => {
    if (isOpen && !teamA && teamNames.length > 0) {
      setTeamA(teamNames[0]);
      if (teamNames.length > 1) setTeamB(teamNames[1]);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const a = teamA.trim();
    const b = teamB.trim();
    if (!a || !b) {
      setError("Both team names are required.");
      return;
    }
    if (a.toLowerCase() === b.toLowerCase()) {
      setError("Teams must be different.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(a, b, scoreA, scoreB);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 border border-dashed border-line text-ink-dim text-sm font-medium hover:bg-raised hover:text-ink active:scale-[0.99] transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add match result
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-line bg-panel p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">
          Add match result
        </h2>
        <button
          type="button"
          onClick={onToggle}
          className="text-ink-faint hover:text-ink p-1"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M12 4L4 12M4 4l8 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}

      {/* Team dropdowns */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim mb-1">
            Team A
          </label>
          <select
            value={teamA}
            onChange={(e) => setTeamA(e.target.value)}
            className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink"
          >
            {teamNames.map((name) => (
              <option
                key={name}
                value={name}
                disabled={name.toLowerCase() === teamB.trim().toLowerCase()}
              >
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim mb-1">
            Team B
          </label>
          <select
            value={teamB}
            onChange={(e) => setTeamB(e.target.value)}
            className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink"
          >
            {teamNames.map((name) => (
              <option
                key={name}
                value={name}
                disabled={name.toLowerCase() === teamA.trim().toLowerCase()}
              >
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Score inputs */}
      <div className="flex items-center justify-center gap-3">
        <div className="text-center">
          <label className="block text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim mb-1">
            {teamA || "Team A"}
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={scoreA}
            onChange={(e) =>
              setScoreA(Math.max(0, parseInt(e.target.value || "0", 10)))
            }
            className="w-16 text-center text-xl font-bold tabular-nums border border-line bg-raised px-2 py-1.5 text-ink"
          />
        </div>
        <span className="text-ink-faint text-lg font-bold select-none">:</span>
        <div className="text-center">
          <label className="block text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim mb-1">
            {teamB || "Team B"}
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={scoreB}
            onChange={(e) =>
              setScoreB(Math.max(0, parseInt(e.target.value || "0", 10)))
            }
            className="w-16 text-center text-xl font-bold tabular-nums border border-line bg-raised px-2 py-1.5 text-ink"
          />
        </div>
      </div>

      {/* Buttons */}
      <div className="flex items-center justify-center gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-ink text-board text-sm font-bold hover:bg-white/90 disabled:opacity-60 active:scale-95 transition-colors min-h-[36px]"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {submitting ? "Adding…" : "Save match"}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1 px-4 py-2 border border-line text-ink-dim text-sm font-medium hover:bg-raised hover:text-ink active:scale-95 transition-colors min-h-[36px]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
