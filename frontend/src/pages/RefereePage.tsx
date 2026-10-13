import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../auth/useAuth";
import { parseSessionStart } from "../utils/datetime";
import {
  fetchSessionMatches,
  startMatches,
  createMatch,
  createNewPendingMatch,
  startTimer,
  pauseTimer,
  resumeTimer,
  resetMatch,
  incrementScore,
  endMatch,
  setScores,
  deleteMatch,
  type MatchSummary,
} from "../api/matchesApi";
import {
  fetchSessionDetail,
  fetchSessionTeams,
  type SessionDetail,
  type TeamsResponse,
} from "../api/sessionsApi";
import { subscribeSessionData } from "../utils/sessionDataBus";
import { useStewardUi } from "../hooks/useStewardUi";
import { GoalList } from "../components/GoalList";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Edit,
  Flag,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";

function formatTimer(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getTimerColor(seconds: number, total: number): string {
  if (total <= 0) return "text-gray-400";
  const ratio = seconds / total;
  if (ratio > 1 / 3) return "text-emerald-600 dark:text-emerald-400";
  if (ratio > 1 / 10) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

// ── Winner Picker Modal ──────────────────────────────────────────

function WinnerPickerModal({
  match,
  onPick,
  onCancel,
}: {
  match: MatchSummary;
  onPick: (winner: "a" | "b") => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-900 dark:text-white text-center">
          Pick the winner
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
          Match {match.match_number} ended {match.score_a} — {match.score_b}.
          Who won?
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onPick("a")}
            className="py-4 rounded-xl bg-emerald-600 text-white font-bold text-lg hover:bg-emerald-700 active:scale-[0.98] transition-transform"
          >
            {match.team_a.name}
          </button>
          <button
            type="button"
            onClick={() => onPick("b")}
            className="py-4 rounded-xl bg-blue-600 text-white font-bold text-lg hover:bg-blue-700 active:scale-[0.98] transition-transform"
          >
            {match.team_b.name}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Manual Match Form ────────────────────────────────────────────

function ManualMatchForm({
  onSubmit,
  onCancel,
  onDelete,
  existingTeamNames,
  initial,
}: {
  onSubmit: (body: {
    team_a_name: string;
    team_b_name: string;
    score_a: number;
    score_b: number;
  }) => void;
  onCancel: () => void;
  onDelete?: () => void;
  existingTeamNames: string[];
  initial?: {
    team_a_name: string;
    team_b_name: string;
    score_a: number;
    score_b: number;
  };
}) {
  const [teamA, setTeamA] = useState(
    initial?.team_a_name ?? existingTeamNames[0] ?? "",
  );
  const [teamB, setTeamB] = useState(
    initial?.team_b_name ?? existingTeamNames[1] ?? "",
  );
  const [scoreA, setScoreA] = useState(initial?.score_a ?? 0);
  const [scoreB, setScoreB] = useState(initial?.score_b ?? 0);

  const canSubmit =
    teamA.trim() &&
    teamB.trim() &&
    teamA.trim().toLowerCase() !== teamB.trim().toLowerCase();
  const isEdit = !!initial;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-4">
      <datalist id="miootz-team-names">
        {existingTeamNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <h3 className="text-base font-bold text-gray-900 dark:text-white">
        {isEdit ? "Edit match result" : "Add match result"}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Team A
          </label>
          <input
            type="text"
            value={teamA}
            onChange={(e) => setTeamA(e.target.value)}
            placeholder="Team name"
            maxLength={60}
            disabled={isEdit}
            list={isEdit ? undefined : "miootz-team-names"}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Team B
          </label>
          <input
            type="text"
            value={teamB}
            onChange={(e) => setTeamB(e.target.value)}
            placeholder="Team name"
            maxLength={60}
            disabled={isEdit}
            list={isEdit ? undefined : "miootz-team-names"}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Score A
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScoreA((s) => Math.max(0, s - 1))}
              className="w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-lg font-bold hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition-transform"
            >
              −
            </button>
            <span className="flex-1 text-center text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
              {scoreA}
            </span>
            <button
              type="button"
              onClick={() => setScoreA((s) => s + 1)}
              className="w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-lg font-bold hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition-transform"
            >
              +
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Score B
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScoreB((s) => Math.max(0, s - 1))}
              className="w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-lg font-bold hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition-transform"
            >
              −
            </button>
            <span className="flex-1 text-center text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
              {scoreB}
            </span>
            <button
              type="button"
              onClick={() => setScoreB((s) => s + 1)}
              className="w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-lg font-bold hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition-transform"
            >
              +
            </button>
          </div>
        </div>
      </div>
      <div className="flex gap-3 pt-1">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="py-3 px-4 rounded-xl border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 font-semibold hover:bg-red-50 dark:hover:bg-red-950/20 active:scale-[0.98] transition-transform flex items-center gap-1.5"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-[0.98] transition-transform"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            onSubmit({
              team_a_name: teamA.trim(),
              team_b_name: teamB.trim(),
              score_a: scoreA,
              score_b: scoreB,
            })
          }
          disabled={!canSubmit}
          className="flex-1 py-3 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          Save result
        </button>
      </div>
    </div>
  );
}

// ── Final Standings ──────────────────────────────────────────────

function FinalStandings({ matches }: { matches: MatchSummary[] }) {
  const completed = matches.filter((m) => m.status === "completed");
  if (completed.length === 0) return null;

  // Final (last) match result
  const lastMatch = completed[completed.length - 1];

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3 py-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40">
          <CheckCircle2
            className="h-9 w-9 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            All matches complete
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {completed.length} match{completed.length !== 1 ? "es" : ""} played
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 dark:bg-amber-950/30 px-4 py-1.5">
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Final match: {lastMatch.team_a.name} {lastMatch.score_a} –{" "}
            {lastMatch.score_b} {lastMatch.team_b.name}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {completed.map((m) => {
          const winner =
            m.score_a > m.score_b
              ? m.team_a.name
              : m.score_b > m.score_a
                ? m.team_b.name
                : null;
          return (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3"
            >
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Match {m.match_number}
              </span>
              <div className="flex items-center gap-3">
                <span
                  className={`text-sm font-medium ${
                    winner === m.team_a.name
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-gray-600 dark:text-gray-400"
                  }`}
                >
                  {m.team_a.name} {m.score_a}
                </span>
                <span className="text-gray-400">—</span>
                <span
                  className={`text-sm font-medium ${
                    winner === m.team_b.name
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-gray-600 dark:text-gray-400"
                  }`}
                >
                  {m.score_b} {m.team_b.name}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────

export function RefereePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { tokens } = useAuth();
  const { showToast } = useToast();
  const sid = sessionId ? parseInt(sessionId, 10) : NaN;

  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [currentMatch, setCurrentMatch] = useState<MatchSummary | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const halfTimeTriggeredAt = useRef<number | null>(null);
  const prevRatioRef = useRef<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    | { kind: "end" }
    | { kind: "reset" }
    | { kind: "delete"; matchId: number }
    | null
  >(null);
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showWinnerPicker, setShowWinnerPicker] = useState(false);
  const [pendingEndMatch, setPendingEndMatch] = useState<MatchSummary | null>(
    null,
  );
  const [showManualForm, setShowManualForm] = useState(false);
  const [editingMatch, setEditingMatch] = useState<MatchSummary | null>(null);
  const [halfTimeFlash, setHalfTimeFlash] = useState(false);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(
    null,
  );
  const [teamsData, setTeamsData] = useState<TeamsResponse["teams"] | null>(
    null,
  );
  const [selectingTeams, setSelectingTeams] = useState(false);
  const [selectedTeamA, setSelectedTeamA] = useState(0);
  const [selectedTeamB, setSelectedTeamB] = useState(1);

  // Steward gate / goal log — fed by the ONE shared session-data feed
  // (see the hub subscription below). Any present member may use the
  // controls when the backend gate opens, not only admins.
  const { steward, goals, applyEvent, removeGoal, refreshGoals } =
    useStewardUi(sid, currentMatch?.id ?? null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Drives deadline re-evaluation without waiting for SSE (see effect below).
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Deadline: 15 min after scheduled session end (computed from detail).
  const deadline = (() => {
    if (!sessionDetail?.start_time) return null;
    const start = parseSessionStart(sessionDetail.start_time).getTime();
    const durationMin = sessionDetail.duration_minutes ?? 120;
    const end = start + durationMin * 60_000;
    return end + 15 * 60_000; // 15 min grace
  })();
  const isPastDeadline = deadline != null && nowMs > deadline;

  // Re-render as the deadline passes even when no SSE events arrive, so the
  // UI locks on time instead of staying open until the next event.
  useEffect(() => {
    if (deadline == null) return;
    setNowMs(Date.now());
    if (Date.now() > deadline) return;
    const iv = setInterval(() => {
      const n = Date.now();
      setNowMs(n);
      if (n > deadline) clearInterval(iv);
    }, 1000);
    return () => clearInterval(iv);
  }, [deadline]);

  const loadMatches = useCallback(async () => {
    try {
      const res = await fetchSessionMatches(sid);
      setMatches(res.matches);
      const active = res.matches.find(
        (m) => m.status === "active" || m.status === "time_up",
      );
      const pending = res.matches.find((m) => m.status === "pending");
      if (active) {
        setCurrentMatch(active);
        setTimerSeconds(active.timer_seconds_remaining);
        setIsPaused(active.timer_paused);
        setTimerEndsAt(
          active.timer_ends_at ? Date.parse(active.timer_ends_at) : null,
        );
      } else if (pending) {
        setCurrentMatch(pending);
        setTimerSeconds(pending.timer_total_seconds);
        setIsPaused(false);
      } else {
        setCurrentMatch(null);
        setTimerSeconds(0);
        setIsPaused(false);
      }
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Failed to load matches",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [sid, showToast]);

  useEffect(() => {
    void loadMatches();
  }, [loadMatches]);

  useEffect(() => {
    if (isNaN(sid)) return;
    fetchSessionDetail(sid)
      .then(setSessionDetail)
      .catch(() => {});
    fetchSessionTeams(sid)
      .then((r) => setTeamsData(r.teams))
      .catch(() => {});
  }, [sid]);

  // SSE — rides the ONE existing session-data connection through the shared
  // hub (utils/sessionDataBus); no second EventSource here anymore.
  // Scoring types (goal_added / goal_removed / lease_acquired /
  // lease_released) go through the steward hook; timer types drive the
  // clock; on link (re)connect we refetch snapshots, never replay events.
  useEffect(() => {
    let wasLive = false; // hub pushes current status on subscribe
    return subscribeSessionData(
      sid,
      tokens?.accessToken,
      (data) => {
        if (applyEvent(data)) {
          // goal_added / goal_removed / lease_acquired / lease_released —
          // rows + lease refreshed via the hook; pull the new score in too.
          void loadMatches();
          return;
        }
        const secs =
          typeof data.seconds_remaining === "number"
            ? Math.max(0, data.seconds_remaining)
            : null;
        const endsAt =
          typeof data.ends_at === "string" ? Date.parse(data.ends_at) : NaN;
        switch (data.type) {
          case "match_timer_started":
            setTimerSeconds(secs ?? 0);
            setIsPaused(false);
            prevRatioRef.current = null;
            setTimerEndsAt(Number.isFinite(endsAt) ? endsAt : null);
            break;
          case "match_timer_paused":
            setTimerSeconds(secs ?? 0);
            setIsPaused(true);
            setTimerEndsAt(null);
            break;
          case "match_timer_resumed":
            setTimerSeconds(secs ?? 0);
            setIsPaused(false);
            setTimerEndsAt(Number.isFinite(endsAt) ? endsAt : null);
            break;
          case "match_timer_expired":
            setTimerSeconds(0);
            setIsPaused(false);
            setTimerEndsAt(null);
            void loadMatches();
            break;
          case "match_ended":
          case "match_created":
          case "match_reset":
          case "match_score_updated":
            void loadMatches();
            break;
        }
      },
      (live) => {
        if (live && !wasLive) {
          // (Re)connected after a gap — refetch snapshots, never replay.
          void loadMatches();
          void refreshGoals();
        }
        wasLive = live;
      },
    );
  }, [sid, loadMatches, applyEvent, refreshGoals, tokens?.accessToken]);

  // Timer tick
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!currentMatch || isPaused || currentMatch.status !== "active") return;
    intervalRef.current = setInterval(() => {
      if (timerEndsAt != null) {
        // Server-authoritative: derive remaining from the shared end timestamp
        setTimerSeconds(
          Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000)),
        );
      } else {
        setTimerSeconds((prev) => {
          if (prev <= 1) return 0;
          return prev - 1;
        });
      }
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [currentMatch, isPaused, timerEndsAt]);

  // Half-time: one-shot flash when the timer crosses the 50% mark
  useEffect(() => {
    if (!currentMatch || currentMatch.status !== "active" || isPaused) {
      prevRatioRef.current = null;
      return;
    }
    const ratio = timerSeconds / currentMatch.timer_total_seconds;
    const prev = prevRatioRef.current;
    prevRatioRef.current = ratio;
    if (prev != null && prev > 0.5 && ratio <= 0.5) {
      // Just crossed the 50% mark — one-shot half-time flash
      halfTimeTriggeredAt.current = Date.now();
      setHalfTimeFlash(true);
    }
  }, [timerSeconds, currentMatch, isPaused]);

  // Keep the half-time flash visible for 3 seconds
  useEffect(() => {
    if (!halfTimeFlash) return;
    const t = setTimeout(() => setHalfTimeFlash(false), 3000);
    return () => clearTimeout(t);
  }, [halfTimeFlash]);

  // Re-sync with the server when the tab comes back into view
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadMatches();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadMatches]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
      await loadMatches();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Request failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const handleStartAll = async (body?: {
    team_a_idx?: number;
    team_b_idx?: number;
  }) => {
    await run("Starting...", async () => {
      const res = await startMatches(sid, body);
      showToast(
        `Matches started! ${res.match.team_a.name} vs ${res.match.team_b.name}`,
        "success",
      );
    });
  };

  const handleStartTimer = async () => {
    if (!currentMatch) return;
    await run("Starting timer...", async () => {
      const res = await startTimer(sid, currentMatch.id);
      setTimerSeconds(res.seconds_remaining);
      showToast("Timer started!", "success");
    });
  };

  const handlePauseTimer = async () => {
    if (!currentMatch) return;
    await run("Pausing...", async () => {
      const res = await pauseTimer(sid, currentMatch.id);
      setTimerSeconds(res.seconds_remaining);
    });
  };

  const handleResumeTimer = async () => {
    if (!currentMatch) return;
    await run("Resuming...", async () => {
      const res = await resumeTimer(sid, currentMatch.id);
      setTimerSeconds(res.seconds_remaining);
    });
  };

  const handleReset = async () => {
    if (!currentMatch) return;
    await run("Resetting...", async () => {
      await resetMatch(sid, currentMatch.id);
      showToast("Match reset", "success");
    });
  };

  const handleScore = async (team: "a" | "b", delta = 1) => {
    if (!currentMatch) return;
    setBusy(null); // Don't block rapid taps
    try {
      await incrementScore(sid, currentMatch.id, team, delta);
      // Optimistic update
      setCurrentMatch((prev) =>
        prev
          ? {
              ...prev,
              score_a:
                team === "a" ? Math.max(0, prev.score_a + delta) : prev.score_a,
              score_b:
                team === "b" ? Math.max(0, prev.score_b + delta) : prev.score_b,
            }
          : null,
      );
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Score update failed",
        "error",
      );
      void loadMatches();
    }
  };

  const handleEndMatch = () => {
    if (!currentMatch) return;
    if (currentMatch.score_a !== currentMatch.score_b) {
      // Clear winner — end directly
      void (async () => {
        await run("Ending match...", async () => {
          const res = await endMatch(sid, currentMatch.id);
          showToast(
            `Match ${currentMatch.match_number} over! Winner: ${res.winner_name}`,
            "success",
          );
        });
      })();
    } else {
      // Tie — show picker
      setPendingEndMatch(currentMatch);
      setShowWinnerPicker(true);
    }
  };

  const handleDeleteMatch = async (matchId: number) => {
    await run("Deleting...", async () => {
      await deleteMatch(sid, matchId);
      showToast("Match deleted", "success");
      setShowManualForm(false);
      setEditingMatch(null);
    });
  };

  const handlePickWinner = async (winner: "a" | "b") => {
    setShowWinnerPicker(false);
    if (!pendingEndMatch) return;
    await run("Ending match...", async () => {
      const res = await endMatch(sid, pendingEndMatch.id, winner);
      showToast(
        `Match ${pendingEndMatch.match_number} over! Winner: ${res.winner_name}`,
        "success",
      );
      setPendingEndMatch(null);
    });
  };

  // Dispatch the pending destructive/confirmable action
  const handleConfirmAction = async () => {
    const action = confirmAction;
    if (!action) return;
    setConfirmAction(null);
    if (action.kind === "end") {
      handleEndMatch();
    } else if (action.kind === "reset") {
      await handleReset();
    } else if (action.kind === "delete") {
      await handleDeleteMatch(action.matchId);
    }
  };

  const handleSaveManualMatch = async (body: {
    team_a_name: string;
    team_b_name: string;
    score_a: number;
    score_b: number;
  }) => {
    if (editingMatch) {
      await run("Saving...", async () => {
        await setScores(sid, editingMatch.id, body.score_a, body.score_b);
        showToast("Score updated", "success");
        setEditingMatch(null);
        setShowManualForm(false);
      });
    } else {
      await run("Saving...", async () => {
        await createMatch(sid, body);
        showToast("Match result saved", "success");
        setShowManualForm(false);
      });
    }
  };

  const handleStartNewMatch = async () => {
    await run("Creating match...", async () => {
      await createNewPendingMatch(sid, {
        team_a_idx: selectedTeamA,
        team_b_idx: selectedTeamB,
      });
      setSelectingTeams(false);
      showToast("New match ready — start the timer!", "success");
    });
  };

  // Steward gate (mirrors the backend): any present member inside the
  // window may use the controls; locked users see a named reason line.
  const canControl = !!steward?.can_control;

  if (!canControl) {
    const line =
      steward == null
        ? "Loading steward state…"
        : steward.reason === "not_attending"
          ? "You're not marked as attending."
          : steward.reason === "outside_window"
            ? "Scoring is closed — you're outside the session window."
            : "Scoring controls unavailable.";
    return (
      <div className="p-6 text-center text-red-600 dark:text-red-400">
        {line}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
      </div>
    );
  }

  const completedMatches = matches.filter((m) => m.status === "completed");
  const allComplete =
    matches.length > 0 &&
    matches.every((m) => m.status === "completed") &&
    !currentMatch;

  // Show next match preview after a match ended
  const nextMatch = matches.find(
    (m) =>
      m.status === "pending" &&
      m.match_number > (currentMatch?.match_number || 0),
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-gradient-to-r from-violet-600 to-purple-600 dark:from-violet-700 dark:to-purple-800 shadow-lg">
        <div className="max-w-lg mx-auto flex items-center gap-3 px-4 py-3.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-white/20 active:scale-95 transition-transform"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white leading-tight">
              Match Control
            </h1>
            <p className="text-xs text-violet-200">
              {currentMatch
                ? `Match ${currentMatch.match_number} · ${currentMatch.team_a.name} vs ${currentMatch.team_b.name}`
                : allComplete
                  ? "All matches done"
                  : "No active match"}
            </p>
          </div>
          {currentMatch && (
            <button
              type="button"
              onClick={() => setConfirmAction({ kind: "reset" })}
              disabled={busy !== null}
              className="p-2 rounded-lg hover:bg-white/20 disabled:opacity-40 active:scale-95 transition-transform"
              aria-label="Reset match"
            >
              <RotateCcw className="h-5 w-5 text-white" />
            </button>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {isPastDeadline ? (
          /* Locked — past deadline */
          <div className="space-y-4">
            <div className="text-center space-y-2 py-4">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-800">
                <CheckCircle2
                  className="h-7 w-7 text-gray-500 dark:text-gray-400"
                  aria-hidden
                />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-500 dark:text-gray-400">
                  Session closed
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Locked 15 min after session end
                </p>
              </div>
            </div>
            <FinalStandings matches={matches} />
          </div>
        ) : showManualForm ? (
          <ManualMatchForm
            onSubmit={handleSaveManualMatch}
            onCancel={() => {
              setShowManualForm(false);
              setEditingMatch(null);
            }}
            onDelete={
              editingMatch
                ? () =>
                    setConfirmAction({
                      kind: "delete",
                      matchId: editingMatch.id,
                    })
                : undefined
            }
            existingTeamNames={matches.flatMap((m) => [
              m.team_a.name,
              m.team_b.name,
            ])}
            initial={
              editingMatch
                ? {
                    team_a_name: editingMatch.team_a.name,
                    team_b_name: editingMatch.team_b.name,
                    score_a: editingMatch.score_a,
                    score_b: editingMatch.score_b,
                  }
                : undefined
            }
          />
        ) : allComplete && selectingTeams ? (
          /* Team selection for new match */
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Pick your teams
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Select two teams to play the next match.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Team A
                </label>
                <div className="relative">
                  <select
                    value={selectedTeamA}
                    onChange={(e) => setSelectedTeamA(Number(e.target.value))}
                    className="w-full appearance-none rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 pr-8 text-sm font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {teamsData?.map((t, i) => (
                      <option
                        key={t.id}
                        value={i}
                        disabled={i === selectedTeamB}
                      >
                        {t.name ?? `Team ${i + 1}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 bottom-3 h-4 w-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Team B
                </label>
                <div className="relative">
                  <select
                    value={selectedTeamB}
                    onChange={(e) => setSelectedTeamB(Number(e.target.value))}
                    className="w-full appearance-none rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 pr-8 text-sm font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {teamsData?.map((t, i) => (
                      <option
                        key={t.id}
                        value={i}
                        disabled={i === selectedTeamA}
                      >
                        {t.name ?? `Team ${i + 1}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 bottom-3 h-4 w-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectingTeams(false)}
                className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-[0.98] transition-transform"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleStartNewMatch()}
                disabled={busy !== null || selectedTeamA === selectedTeamB}
                className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-40 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                <Play className="h-4 w-4" />
                Start match
              </button>
            </div>
          </div>
        ) : allComplete ? (
          /* All matches done but deadline not passed — offer to add more */
          <div className="text-center space-y-6 py-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-violet-100 dark:bg-violet-900/40">
              <CheckCircle2
                className="h-7 w-7 text-violet-600 dark:text-violet-400"
                aria-hidden
              />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {completedMatches.length} match
                {completedMatches.length !== 1 ? "es" : ""} recorded
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Add another match or edit existing results below.
              </p>
            </div>
            <div className="flex flex-col gap-3 items-center">
              <button
                type="button"
                onClick={() => setSelectingTeams(true)}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-emerald-600 text-white text-lg font-bold hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98] transition-transform min-h-[56px]"
              >
                <Play className="h-5 w-5" />
                Start new match
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingMatch(null);
                  setShowManualForm(true);
                }}
                className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-violet-600 text-white text-lg font-bold hover:bg-violet-700 active:scale-[0.98] transition-transform min-h-[56px]"
              >
                <Plus className="h-5 w-5" />
                Add match result
              </button>
            </div>
          </div>
        ) : !currentMatch ? (
          /* No match started yet */
          <div className="text-center space-y-6 py-12">
            <Flag className="h-16 w-16 mx-auto text-gray-300 dark:text-gray-700" />
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Ready to start?
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {teamsData && teamsData.length > 2
                  ? "Pick which two teams play first."
                  : "Start the first match between Team 1 and Team 2."}
              </p>
            </div>
            {teamsData && teamsData.length > 2 ? (
              <div className="space-y-4 max-w-sm mx-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 text-left">
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      Team A
                    </label>
                    <div className="relative">
                      <select
                        value={selectedTeamA}
                        onChange={(e) =>
                          setSelectedTeamA(Number(e.target.value))
                        }
                        className="w-full appearance-none rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 pr-8 text-sm font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {teamsData.map((t, i) => (
                          <option
                            key={t.id}
                            value={i}
                            disabled={i === selectedTeamB}
                          >
                            {t.name ?? `Team ${i + 1}`}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 bottom-3 h-4 w-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div className="space-y-1.5 text-left">
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      Team B
                    </label>
                    <div className="relative">
                      <select
                        value={selectedTeamB}
                        onChange={(e) =>
                          setSelectedTeamB(Number(e.target.value))
                        }
                        className="w-full appearance-none rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 pr-8 text-sm font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {teamsData.map((t, i) => (
                          <option
                            key={t.id}
                            value={i}
                            disabled={i === selectedTeamA}
                          >
                            {t.name ?? `Team ${i + 1}`}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 bottom-3 h-4 w-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void handleStartAll({
                      team_a_idx: selectedTeamA,
                      team_b_idx: selectedTeamB,
                    })
                  }
                  disabled={busy !== null || selectedTeamA === selectedTeamB}
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-violet-600 text-white text-lg font-bold hover:bg-violet-700 disabled:opacity-50 active:scale-[0.98] transition-transform min-h-[56px]"
                >
                  {busy ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Flag className="h-5 w-5" />
                  )}
                  Start Matches
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleStartAll()}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-violet-600 text-white text-lg font-bold hover:bg-violet-700 disabled:opacity-50 active:scale-[0.98] transition-transform min-h-[56px]"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Flag className="h-5 w-5" />
                )}
                Start Matches
              </button>
            )}
          </div>
        ) : (
          /* Active or pending match */
          <>
            {/* Scoreboard */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
              {/* Half-time flash */}
              {halfTimeFlash && (
                <div className="text-center py-2 px-4 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-lg font-bold animate-pulse">
                  ⚡ Half-time!
                </div>
              )}

              {/* Teams and scores */}
              <div className="flex items-center justify-between">
                <div className="flex-1 text-right min-w-0 pr-4">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                    {currentMatch.team_a.name}
                  </p>
                  <p className="text-5xl font-bold text-gray-900 dark:text-white tabular-nums">
                    {currentMatch.score_a}
                  </p>
                </div>
                <span className="text-2xl text-gray-300 dark:text-gray-700 shrink-0">
                  —
                </span>
                <div className="flex-1 text-left min-w-0 pl-4">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                    {currentMatch.team_b.name}
                  </p>
                  <p className="text-5xl font-bold text-gray-900 dark:text-white tabular-nums">
                    {currentMatch.score_b}
                  </p>
                </div>
              </div>

              {/* Timer */}
              <div className="text-center">
                <span
                  className={`text-4xl font-bold tabular-nums ${getTimerColor(
                    timerSeconds,
                    currentMatch.timer_total_seconds,
                  )}`}
                >
                  {formatTimer(timerSeconds)}
                </span>
                {isPaused && currentMatch.status === "active" && (
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1">
                    Paused
                  </p>
                )}
              </div>
            </div>

            {/* Timer controls */}
            {currentMatch.status === "pending" && (
              <button
                type="button"
                onClick={() => void handleStartTimer()}
                disabled={busy !== null}
                className="w-full py-5 rounded-2xl bg-emerald-600 text-white text-xl font-bold hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-3 min-h-[56px]"
              >
                <Play className="h-6 w-6" />
                Start Timer
              </button>
            )}

            {currentMatch.status === "active" && !isPaused && (
              <button
                type="button"
                onClick={() => void handlePauseTimer()}
                disabled={busy !== null}
                className="w-full py-5 rounded-2xl bg-amber-500 text-white text-xl font-bold hover:bg-amber-600 disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-3 min-h-[56px]"
              >
                <Pause className="h-6 w-6" />
                Pause
              </button>
            )}

            {currentMatch.status === "active" && isPaused && (
              <button
                type="button"
                onClick={() => void handleResumeTimer()}
                disabled={busy !== null}
                className="w-full py-5 rounded-2xl bg-emerald-600 text-white text-xl font-bold hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-3 min-h-[56px]"
              >
                <Play className="h-6 w-6" />
                Resume
              </button>
            )}

            {/* Score controls */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-center text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                  {currentMatch.team_a.name}
                </p>
                <button
                  type="button"
                  onClick={() => void handleScore("a")}
                  className="w-full py-6 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border-2 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-3xl font-bold hover:bg-emerald-100 dark:hover:bg-emerald-950/50 active:bg-emerald-200 dark:active:bg-emerald-900/50 active:scale-[0.97] transition-transform min-h-[80px]"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => void handleScore("a", -1)}
                  className="w-full py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-[0.97] transition-transform"
                >
                  −1
                </button>
              </div>
              <div className="space-y-2">
                <p className="text-center text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                  {currentMatch.team_b.name}
                </p>
                <button
                  type="button"
                  onClick={() => void handleScore("b")}
                  className="w-full py-6 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-3xl font-bold hover:bg-blue-100 dark:hover:bg-blue-950/50 active:bg-blue-200 dark:active:bg-blue-900/50 active:scale-[0.97] transition-transform min-h-[80px]"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => void handleScore("b", -1)}
                  className="w-full py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-[0.97] transition-transform"
                >
                  −1
                </button>
              </div>
            </div>

            {/* Goals log — attribution + delete on light confirm (gate: steward). */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-1">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Goals log
              </h3>
              <GoalList
                goals={goals}
                teamAName={currentMatch.team_a.name}
                teamBName={currentMatch.team_b.name}
                canDelete={canControl}
                onDelete={async (g) => {
                  await removeGoal(g.id);
                }}
              />
            </div>

            {/* End match */}
            <button
              type="button"
              onClick={() => setConfirmAction({ kind: "end" })}
              disabled={busy !== null}
              className="w-full py-5 rounded-2xl bg-red-600 text-white text-xl font-bold hover:bg-red-700 disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-3 min-h-[56px]"
            >
              <Flag className="h-6 w-6" />
              End Match
            </button>

            {/* Delete match */}
            <button
              type="button"
              onClick={() =>
                currentMatch &&
                setConfirmAction({ kind: "delete", matchId: currentMatch.id })
              }
              disabled={busy !== null}
              className="w-full py-3 rounded-2xl border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-40 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete match
            </button>

            {/* Next match preview */}
            {nextMatch && (
              <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/20 p-4 space-y-2">
                <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">
                  Next match
                </p>
                <p className="text-base text-violet-600 dark:text-violet-400">
                  {nextMatch.team_a.name} vs {nextMatch.team_b.name}
                </p>
              </div>
            )}
          </>
        )}

        {/* Past matches */}
        {completedMatches.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Completed matches
            </h3>
            {completedMatches.map((m) => {
              const winner =
                m.score_a > m.score_b
                  ? m.team_a.name
                  : m.score_b > m.score_a
                    ? m.team_b.name
                    : null;
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 gap-2"
                >
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400 shrink-0">
                    Match {m.match_number}
                  </span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-sm font-semibold truncate ${
                        winner === m.team_a.name
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {m.team_a.name} {m.score_a}
                    </span>
                    <span className="text-gray-400 shrink-0">—</span>
                    <span
                      className={`text-sm font-semibold truncate ${
                        winner === m.team_b.name
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {m.score_b} {m.team_b.name}
                    </span>
                  </div>
                  {!isPastDeadline && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMatch(m);
                          setShowManualForm(true);
                        }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 shrink-0"
                        aria-label={`Edit match ${m.match_number}`}
                      >
                        <Edit className="h-4 w-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmAction({ kind: "delete", matchId: m.id })
                        }
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 shrink-0"
                        aria-label={`Delete match ${m.match_number}`}
                      >
                        <Trash2 className="h-4 w-4 text-gray-400 hover:text-red-600 dark:hover:text-red-400" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Winner picker modal */}
      {/* Confirm destructive actions */}
      <ConfirmDialog
        open={confirmAction != null}
        title={
          confirmAction?.kind === "delete"
            ? "Delete this match?"
            : confirmAction?.kind === "reset"
              ? "Reset this match?"
              : "End this match?"
        }
        description={
          confirmAction?.kind === "delete"
            ? "The match and its score will be permanently removed."
            : confirmAction?.kind === "reset"
              ? "Timer and score will be cleared and the match goes back to ready."
              : "The match will be marked complete."
        }
        confirmLabel={
          confirmAction?.kind === "delete"
            ? "Delete"
            : confirmAction?.kind === "reset"
              ? "Reset"
              : "End match"
        }
        destructive={confirmAction?.kind !== "end"}
        onConfirm={() => void handleConfirmAction()}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Winner picker modal */}
      {showWinnerPicker && pendingEndMatch && (
        <WinnerPickerModal
          match={pendingEndMatch}
          onPick={handlePickWinner}
          onCancel={() => {
            setShowWinnerPicker(false);
            setPendingEndMatch(null);
          }}
        />
      )}
    </div>
  );
}
