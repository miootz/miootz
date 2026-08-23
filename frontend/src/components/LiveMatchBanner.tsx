import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSessionMatches,
  type MatchSummary,
} from '../api/matchesApi';
import { sessionDataEventsUrl } from '../api/sessionsApi';
import { useAuth } from '../auth/useAuth';
import { Timer } from 'lucide-react';

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getTimerColor(seconds: number, total: number): string {
  const ratio = seconds / total;
  if (ratio > 1 / 3) return 'text-emerald-600 dark:text-emerald-400';
  if (ratio > 1 / 10) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function getTimerBg(seconds: number, total: number): string {
  const ratio = seconds / total;
  if (ratio > 1 / 3) return 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800';
  if (ratio > 1 / 10) return 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800';
  return 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800';
}

export function LiveMatchBanner({ sessionId }: { sessionId: string | number }) {
  const { me } = useAuth();
  const sid = typeof sessionId === 'string' ? parseInt(sessionId, 10) : sessionId;
  const [currentMatch, setCurrentMatch] = useState<MatchSummary | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [halfTimeFlash, setHalfTimeFlash] = useState(false);
  const prevRatioRef = useRef<number | null>(null);
  const halfTimeTriggeredAt = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const loadMatch = useCallback(async () => {
    try {
      const res = await fetchSessionMatches(sid);
      const active = res.matches.find(
        (m) => m.status === 'active' || m.status === 'time_up' || m.status === 'pending'
      );
      if (active) {
        setCurrentMatch(active);
        setTimerSeconds(active.timer_seconds_remaining);
        setIsPaused(active.timer_paused);
        setTimerEndsAt(
          active.timer_ends_at ? Date.parse(active.timer_ends_at) : null
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
    void (async () => { await loadMatch(); })();
  }, [loadMatch]);

  // Keep the half-time flash visible for 3 seconds
  useEffect(() => {
    if (!halfTimeFlash) return;
    const t = setTimeout(() => setHalfTimeFlash(false), 3000);
    return () => clearTimeout(t);
  }, [halfTimeFlash]);

  // SSE listener
  useEffect(() => {
    const url = sessionDataEventsUrl(sid);
    const es = new EventSource(url);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'match_timer_started') {
          setTimerSeconds(data.seconds_remaining ?? 0);
          setIsPaused(false);
          prevRatioRef.current = null;
          setTimerEndsAt(data.ends_at ? Date.parse(data.ends_at) : null);
        } else if (data.type === 'match_timer_paused') {
          setTimerSeconds(data.seconds_remaining ?? 0);
          setIsPaused(true);
          setTimerEndsAt(null);
        } else if (data.type === 'match_timer_resumed') {
          setTimerSeconds(data.seconds_remaining ?? 0);
          setIsPaused(false);
          setTimerEndsAt(data.ends_at ? Date.parse(data.ends_at) : null);
        } else if (data.type === 'match_timer_expired') {
          setTimerSeconds(0);
          setIsPaused(false);
        } else if (data.type === 'match_score_updated') {
          // Refresh match data on score change
          void loadMatch();
        } else if (data.type === 'match_ended' || data.type === 'match_created' || data.type === 'match_reset') {
          void loadMatch();
        }
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [sid, loadMatch]);

  // Timer tick
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!currentMatch || isPaused || currentMatch.status !== 'active') {
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
  }, [currentMatch?.id, isPaused, currentMatch?.status, loadMatch, timerEndsAt]);

  if (!currentMatch) return null;

  const isTimeUp = currentMatch.status === 'time_up';
  const timerColor = getTimerColor(timerSeconds, currentMatch.timer_total_seconds);
  const timerBg = getTimerBg(timerSeconds, currentMatch.timer_total_seconds);

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
        {me?.is_admin && (
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
      <div className="flex justify-center">
        <span
          className={`text-2xl sm:text-3xl font-bold tabular-nums ${timerColor} transition-colors`}
          style={{
            animation:
              currentMatch.status === 'active' && !isPaused
                ? 'pulse 2s ease-in-out infinite'
                : 'none',
          }}
        >
          {formatTimer(timerSeconds)}
        </span>
      </div>
    </div>
  );
}
