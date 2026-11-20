import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMeetupMatches,
  type MatchSummary,
} from "../api/matchesApi";
import { subscribeMeetupData } from "../utils/meetupDataBus";
import { useAuth } from "../auth/useAuth";
import { useStewardUi } from "../hooks/useStewardUi";
import { Timer, Zap } from "lucide-react";
import { roomPath } from "../utils/demoRoom";

/**
 * Read-only match board for the member home route: the current match
 * (prepared or in progress) with its remaining time, plus nothing else —
 * every control (timer, goals, score) lives in the Referee view
 * (`/meetup-matches/:id`). The completed history below this board
 * (MatchHistoryList) carries the scores and teams of finished matches.
 */

function formatTimer(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getTimerColor(seconds: number, total: number): string {
  if (total <= 0) return "text-ink-faint";
  const ratio = seconds / total;
  if (ratio > 1 / 3) return "text-ink";
  if (ratio > 1 / 10) return "text-live";
  return "text-danger";
}

export function LiveMatchBanner({ meetupId }: { meetupId: string | number }) {
  const { tokens } = useAuth();
  const sid =
    typeof meetupId === "string" ? parseInt(meetupId, 10) : meetupId;
  const [currentMatch, setCurrentMatch] = useState<MatchSummary | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [halfTimeFlash, setHalfTimeFlash] = useState(false);
  const prevRatioRef = useRef<number | null>(null);
  const halfTimeTriggeredAt = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Steward gate — only used to show the "Manage match" link to members who
  // may open the Referee view. Fed from the ONE shared meetup-data feed.
  const { steward, applyEvent, refreshGoals } = useStewardUi(
    sid,
    currentMatch?.id ?? null,
  );

  const loadMatch = useCallback(async () => {
    try {
      const res = await fetchMeetupMatches(sid);
      const current = res.matches.find(
        (m) =>
          m.status === "active" ||
          m.status === "time_up" ||
          m.status === "pending",
      );
      if (current) {
        setCurrentMatch(current);
        setTimerSeconds(
          current.status === "pending"
            ? current.timer_total_seconds
            : current.timer_seconds_remaining,
        );
        setIsPaused(current.timer_paused);
        setTimerEndsAt(
          current.timer_ends_at ? Date.parse(current.timer_ends_at) : null,
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

  // SSE — rides the ONE existing meetup-data connection via the shared
  // hub (utils/meetupDataBus); does not open a second EventSource.
  // Goal/lease events refetch the score; timer events update the clock;
  // on link (re)connect we refetch snapshots so a gap self-heals.
  useEffect(() => {
    let wasLive = false; // hub pushes current status on subscribe
    return subscribeMeetupData(
      sid,
      tokens?.accessToken,
      (data) => {
        if (applyEvent(data)) {
          // goal_added / goal_removed / lease events — pull the new score.
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
          // Clear the shared end timestamp and refetch: a stale ends_at
          // makes the tick clamp to 00:00 while the status stays stale.
          setTimerSeconds(0);
          setIsPaused(false);
          setTimerEndsAt(null);
          void loadMatch();
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

  // Timer tick — server-authoritative: derive remaining from the shared
  // end timestamp the server stamps on start/resume.
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!currentMatch || isPaused || currentMatch.status !== "active") {
      return;
    }
    intervalRef.current = setInterval(() => {
      if (timerEndsAt != null) {
        // Server-authoritative: derive remaining from the shared end timestamp
        const secs = Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000));
        setTimerSeconds(secs);
        const ratio =
          secs / (currentMatch.timer_total_seconds || 1);
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
          const ratio = next / (currentMatch.timer_total_seconds || 1);
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
  const isReady = currentMatch.status === "pending";
  const canControl = !!steward?.can_control;
  const timerColor = getTimerColor(
    timerSeconds,
    currentMatch.timer_total_seconds,
  );

  return (
    <div
      className="border border-line bg-panel"
      role="region"
      aria-label="Match scoreboard"
    >
      {/* Half-time flash */}
      {halfTimeFlash && (
        <div className="flex items-center justify-center gap-1.5 border-b border-line bg-live py-1.5 text-sm font-bold text-board motion-safe:animate-pulse motion-reduce:animate-none">
          <Zap className="h-4 w-4 shrink-0" aria-hidden />
          Half-time!
        </div>
      )}

      {/* Match header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <div className="flex items-center gap-2">
          <Timer className={`h-4 w-4 ${timerColor}`} aria-hidden />
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-ink-dim">
            Match {currentMatch.match_number}
          </span>
          {isReady && (
            <span className="bg-raised px-2 py-0.5 text-xs font-medium text-ink-dim">
              Ready
            </span>
          )}
          {isTimeUp && (
            <span className="bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">
              Time's up
            </span>
          )}
          {isPaused && !isTimeUp && (
            <span className="bg-raised px-2 py-0.5 text-xs font-medium text-ink-dim">
              Paused
            </span>
          )}
        </div>
        {canControl && (
          <a
            href={roomPath(`/meetup-matches/${sid}`)}
            className="text-xs font-medium text-ink-dim hover:text-ink"
          >
            Manage match →
          </a>
        )}
      </div>

      {/* Scoreboard — big numbers above, team slabs 50/50 below */}
      <div>
        <p className="texture-painted-steel py-1.5 text-center text-4xl font-extrabold leading-none tabular-nums text-ink sm:text-5xl">
          {currentMatch.score_a}
          <span className="mx-2 text-xl font-bold text-ink-faint sm:text-2xl">—</span>
          {currentMatch.score_b}
        </p>
        <div className="flex items-stretch border-t border-line">
          <div className="flex min-w-0 flex-1 items-center justify-center bg-team-a px-3 py-2.5">
            <p className="max-w-full truncate text-base font-extrabold uppercase tracking-wide text-white sm:text-lg">
              {currentMatch.team_a.name}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center bg-team-b px-3 py-2.5">
            <p className="max-w-full truncate text-base font-extrabold uppercase tracking-wide text-white sm:text-lg">
              {currentMatch.team_b.name}
            </p>
          </div>
        </div>
      </div>

      {/* Remaining time — display only; controls live in the Referee view */}
      <div className="flex flex-col items-center border-t border-line px-4 py-4">
        <span
          className={`text-3xl font-extrabold tabular-nums sm:text-4xl ${timerColor}`}
          style={{
            animation:
              currentMatch.status === "active" && !isPaused
                ? "pulse 2s ease-in-out infinite"
                : "none",
          }}
        >
          {formatTimer(timerSeconds)}
        </span>
        <p className="mt-1 text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint">
          {isReady
            ? "First whistle not called"
            : isTimeUp
              ? "Clock stopped"
              : isPaused
                ? "Clock stopped"
                : "Remaining"}
        </p>
      </div>
    </div>
  );
}
