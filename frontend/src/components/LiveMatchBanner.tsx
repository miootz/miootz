import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchSessionMatches,
  pauseTimer,
  resetMatch,
  resumeTimer,
  startTimer,
  type MatchSummary,
} from "../api/matchesApi";
import { subscribeSessionData } from "../utils/sessionDataBus";
import { useAuth } from "../auth/useAuth";
import { useStewardUi } from "../hooks/useStewardUi";
import { GoalEntrySheet } from "./GoalEntrySheet";
import { GoalList } from "./GoalList";
import { leaseBusyLabel } from "../utils/lease";
import { Timer } from "lucide-react";

function formatTimer(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getTimerColor(seconds: number, total: number): string {
  const ratio = seconds / total;
  if (ratio > 1 / 3) return "text-emerald-600 dark:text-emerald-400";
  if (ratio > 1 / 10) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function getTimerBg(seconds: number, total: number): string {
  const ratio = seconds / total;
  if (ratio > 1 / 3)
    return "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800";
  if (ratio > 1 / 10)
    return "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800";
  return "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";
}

/** Steward gate → reason line shown to locked members (never silent). */
function stewardReasonLine(reason: string | undefined): string {
  if (reason === "not_attending") return "You're not marked as attending.";
  if (reason === "outside_window")
    return "Scoring is closed — you're outside the session window.";
  return "";
}

export function LiveMatchBanner({ sessionId }: { sessionId: string | number }) {
  const { me, tokens } = useAuth();
  const sid =
    typeof sessionId === "string" ? parseInt(sessionId, 10) : sessionId;
  const [currentMatch, setCurrentMatch] = useState<MatchSummary | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [halfTimeFlash, setHalfTimeFlash] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const prevRatioRef = useRef<number | null>(null);
  const halfTimeTriggeredAt = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Steward gate / lease chip / goal log — fed from the ONE SSE channel this
  // banner already owns (see effect below). No second EventSource.
  const { steward, lease, leaseLeft, goals, applyEvent, removeGoal, refreshGoals } =
    useStewardUi(sid, currentMatch?.id ?? null);

  const loadMatch = useCallback(async () => {
    try {
      const res = await fetchSessionMatches(sid);
      const active = res.matches.find(
        (m) =>
          m.status === "active" ||
          m.status === "time_up" ||
          m.status === "pending",
      );
      if (active) {
        setCurrentMatch(active);
        setTimerSeconds(active.timer_seconds_remaining);
        setIsPaused(active.timer_paused);
        setTimerEndsAt(
          active.timer_ends_at ? Date.parse(active.timer_ends_at) : null,
        );
      } else {
        setCurrentMatch(null);
        setTimerSeconds(0);
        setIsPaused(false);
        setTimerEndsAt(null);
        prevRatioRef.current = null;
      }
    } catch {
      // silent
    }
  }, [sid]);

  useEffect(() => {
    void (async () => {
      await loadMatch();
    })();
  }, [loadMatch]);

  // Keep the half-time flash visible for 3 seconds
  useEffect(() => {
    if (!halfTimeFlash) return;
    const t = setTimeout(() => setHalfTimeFlash(false), 3000);
    return () => clearTimeout(t);
  }, [halfTimeFlash]);

  // SSE — rides the ONE existing session-data connection via the shared
  // hub (utils/sessionDataBus); does not open a second EventSource.
  // Scoring events (goal_added / goal_removed / lease_acquired /
  // lease_released) flow through the hook's applyEvent (snapshot refetch,
  // never replay); timer events update the clock here; on link (re)connect
  // we refetch snapshots so a gap self-heals.
  useEffect(() => {
    let wasLive = false; // hub pushes current status on subscribe
    return subscribeSessionData(
      sid,
      tokens?.accessToken,
      (data) => {
        if (applyEvent(data)) {
          // goal_added / goal_removed / lease_acquired / lease_released —
          // rows refreshed via the hook; pull the new score into the board.
          void loadMatch();
          return;
        }
        if (data.type === "match_timer_started") {
          const secs =
            typeof data.seconds_remaining === "number"
              ? Math.max(0, data.seconds_remaining)
              : 0;
          setTimerSeconds(secs);
          setIsPaused(false);
          prevRatioRef.current = null;
          const endsAt =
            typeof data.ends_at === "string" ? Date.parse(data.ends_at) : NaN;
          setTimerEndsAt(Number.isFinite(endsAt) ? endsAt : null);
        } else if (data.type === "match_timer_paused") {
          const secs =
            typeof data.seconds_remaining === "number"
              ? Math.max(0, data.seconds_remaining)
              : 0;
          setTimerSeconds(secs);
          setIsPaused(true);
          setTimerEndsAt(null);
        } else if (data.type === "match_timer_resumed") {
          const secs =
            typeof data.seconds_remaining === "number"
              ? Math.max(0, data.seconds_remaining)
              : 0;
          setTimerSeconds(secs);
          setIsPaused(false);
          const endsAt =
            typeof data.ends_at === "string" ? Date.parse(data.ends_at) : NaN;
          setTimerEndsAt(Number.isFinite(endsAt) ? endsAt : null);
        } else if (data.type === "match_timer_expired") {
          setTimerSeconds(0);
          setIsPaused(false);
        } else if (
          data.type === "match_ended" ||
          data.type === "match_created" ||
          data.type === "match_reset"
        ) {
          void loadMatch();
        }
      },
      (live) => {
        if (live && !wasLive) {
          // (Re)connected after a gap — refetch snapshots, never replay.
          void loadMatch();
          void refreshGoals();
        }
        wasLive = live;
      },
    );
  }, [sid, loadMatch, applyEvent, refreshGoals, tokens?.accessToken]);

  // Timer tick
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!currentMatch || isPaused || currentMatch.status !== "active") {
      return;
    }
    intervalRef.current = setInterval(() => {
      const total = currentMatch.timer_total_seconds;
      if (timerEndsAt != null) {
        // Server-authoritative: derive remaining from the shared end timestamp
        const secs = Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000));
        setTimerSeconds(secs);
        const ratio = secs / total;
        const prev = prevRatioRef.current;
        prevRatioRef.current = ratio;
        if (prev != null && prev > 0.5 && ratio <= 0.5) {
          halfTimeTriggeredAt.current = Date.now();
          setHalfTimeFlash(true);
        }
      } else {
        setTimerSeconds((prev) => {
          if (prev <= 1) {
            // Timer expired — reload to get updated status
            void loadMatch();
            return 0;
          }
          const next = prev - 1;
          const ratio = next / total;
          const prevRatio = prevRatioRef.current;
          prevRatioRef.current = ratio;
          if (prevRatio != null && prevRatio > 0.5 && ratio <= 0.5) {
            halfTimeTriggeredAt.current = Date.now();
            setHalfTimeFlash(true);
          }
          return next;
        });
      }
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [currentMatch, isPaused, loadMatch, timerEndsAt]);

  if (!currentMatch) return null;

  const isTimeUp = currentMatch.status === "time_up";
  const canControl = !!steward?.can_control;
  const leaseHeld = !!lease && leaseLeft > 0;
  const timerColor = getTimerColor(
    timerSeconds,
    currentMatch.timer_total_seconds,
  );
  const timerBg = getTimerBg(timerSeconds, currentMatch.timer_total_seconds);

  const runTimer = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      // Timer calls are idempotent (double-tap is a no-op) — pull fresh state.
      await loadMatch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-xl border ${timerBg} p-4 space-y-3 transition-colors`}
      role="region"
      aria-label="Live match scoreboard"
    >
      {/* Half-time flash */}
      {halfTimeFlash && (
        <div className="text-center py-1 px-3 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-sm font-bold animate-pulse">
          ⚡ Half-time!
        </div>
      )}

      {/* Match header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer className={`h-4 w-4 ${timerColor}`} aria-hidden />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Match {currentMatch.match_number}
          </span>
          {isTimeUp && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
              Time's up!
            </span>
          )}
          {isPaused && !isTimeUp && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              Paused
            </span>
          )}
        </div>
        {canControl && (
          <a
            href={`/session-matches/${sid}`}
            className="text-xs text-violet-600 dark:text-violet-400 hover:underline font-medium"
          >
            Manage match →
          </a>
        )}
      </div>

      {/* Scoreboard */}
      <div className="flex items-center justify-center gap-4 sm:gap-8">
        <div className="flex-1 text-right">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 truncate">
            {currentMatch.team_a.name}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white tabular-nums">
            {currentMatch.score_a}
          </span>
          <span className="text-lg text-gray-400 dark:text-gray-600">—</span>
          <span className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white tabular-nums">
            {currentMatch.score_b}
          </span>
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 truncate">
            {currentMatch.team_b.name}
          </p>
        </div>
      </div>

      {/* Timer */}
      <div className="flex flex-col items-center gap-2">
        <span
          className={`text-2xl sm:text-3xl font-bold tabular-nums ${timerColor} transition-colors`}
          style={{
            animation:
              currentMatch.status === "active" && !isPaused
                ? "pulse 2s ease-in-out infinite"
                : "none",
          }}
        >
          {formatTimer(timerSeconds)}
        </span>

        {/* Controls (present members only — steward gate). */}
        {canControl && !isTimeUp && (
          <div className="flex items-center gap-2">
            {currentMatch.status === "pending" && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runTimer(() => startTimer(sid, currentMatch.id))
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                <Timer className="h-4 w-4" aria-hidden />
                Start timer
              </button>
            )}
            {currentMatch.status === "active" && !isPaused && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runTimer(() => pauseTimer(sid, currentMatch.id))
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                Pause
              </button>
            )}
            {currentMatch.status === "active" && isPaused && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runTimer(() => resumeTimer(sid, currentMatch.id))
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                Resume
              </button>
            )}
          </div>
        )}
        {canControl && isTimeUp && me?.is_admin && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void runTimer(() => resetMatch(sid, currentMatch.id))
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-700 text-white text-xs font-semibold hover:bg-gray-800 disabled:opacity-50 transition-transform"
          >
            Reset (admin)
          </button>
        )}

        {/* + Goal / lease chip — named, never silent. */}
        {canControl && (
          <button
            type="button"
            disabled={leaseHeld || busy}
            onClick={() => setSheetOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-60 active:scale-[0.98] transition-transform"
          >
            {leaseHeld
              ? leaseBusyLabel(lease!.holderName, leaseLeft)
              : "+ Goal"}
          </button>
        )}
        {!canControl && stewardReasonLine(steward?.reason) && (
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {stewardReasonLine(steward?.reason)}
          </p>
        )}
      </div>

      {/* Goal log — visible to everyone, delete when the viewer controls. */}
      <div className="pt-1">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
          Goals
        </p>
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

      {sheetOpen && (
        <GoalEntrySheet
          sessionId={sid}
          match={currentMatch}
          onClose={() => setSheetOpen(false)}
          onLogged={() => {
            // Score + rows refresh via SSE/poll — no local optimistic row.
            void loadMatch();
          }}
        />
      )}
    </div>
  );
}
