import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../auth/useAuth";
import { parseMeetupStart } from "../utils/datetime";
import {
  fetchMeetupMatches,
  startMatches,
  createMatch,
  createNewPendingMatch,
  startTimer,
  pauseTimer,
  resumeTimer,
  resetMatch,
  endMatch,
  setScores,
  deleteMatch,
  type MatchSummary,
} from "../api/matchesApi";
import { deleteGoal, fetchGoals, type GoalRow } from "../api/stewardApi";
import {
  fetchMeetupDetail,
  fetchMeetupTeams,
  type MeetupDetail,
  type TeamsResponse,
} from "../api/meetupsApi";
import { subscribeMeetupData } from "../utils/meetupDataBus";
import { useStewardUi } from "../hooks/useStewardUi";
import { GoalList } from "../components/GoalList";
import { GoalEntrySheet } from "../components/GoalEntrySheet";
import { leaseBusyLabel } from "../utils/lease";
import { hapticFinal, hapticHalfTime, hapticLight } from "../utils/haptics";
import { playFinalWhistle, playHalfTimeWhistle } from "../utils/whistle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SubstitutionsPanel } from "../components/SubstitutionsPanel";
import { TeamReshapeSheet } from "../components/TeamReshapeSheet";
import { AuthContext } from "../auth/auth-context";
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  Edit,
  Flag,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
  X,
} from "lucide-react";

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

/** Roster sorted by skill rating, descending (missing ratings last). */
function sortRosterBySkill<T extends { id: number }>(
  users: T[],
  skillById: Map<number, number>,
): T[] {
  return [...users].sort(
    (a, b) => (skillById.get(b.id) ?? 0) - (skillById.get(a.id) ?? 0),
  );
}

/** Discreet rating label: whole numbers plain, calculated skills 1dp. */
function skillLabel(v: number | undefined): string {
  if (v == null) return "";
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
}

// ── Manual Match Form ────────────────────────────────────────────

function ManualMatchForm({
  onSubmit,
  onCancel,
  onDelete,
  existingTeamNames,
  initial,
  goals = [],
  onAddGoal,
  onEditGoal,
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
  /** Edit mode: the match's goal log (TV-style list, tap to edit). */
  goals?: GoalRow[];
  onAddGoal?: () => void;
  onEditGoal?: (goal: GoalRow) => void;
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
    <div className="border border-line bg-panel p-5 space-y-4">
      <datalist id="miootz-team-names">
        {existingTeamNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <h3 className="text-base font-bold text-ink">
        {isEdit ? "Edit match result" : "Add match result"}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
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
            className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live disabled:opacity-60"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
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
            className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live disabled:opacity-60"
          />
        </div>
      </div>
      {isEdit ? (
        /* Edit mode: the score is the goal log — TV-style rows, +Goal opens
            the sheet, no ±steppers. */
        <>
          <div className="flex items-center justify-center gap-3 py-1">
            <span className="text-3xl font-extrabold tabular-nums text-team-a">
              {initial?.score_a ?? 0}
            </span>
            <span className="text-base text-ink-faint">—</span>
            <span className="text-3xl font-extrabold tabular-nums text-team-b">
              {initial?.score_b ?? 0}
            </span>
          </div>
          <div className="border border-line bg-raised px-3 py-1">
            <GoalList goals={goals} canEdit onEdit={(g) => onEditGoal?.(g)} />
          </div>
          {onAddGoal && (
            <button
              type="button"
              onClick={onAddGoal}
              className="w-full py-3 bg-ink text-board text-sm font-bold hover:bg-white/90 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Goal
            </button>
          )}
        </>
      ) : (
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
            Score A
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScoreA((s) => Math.max(0, s - 1))}
              className="w-10 h-10 border border-line bg-raised text-ink text-lg font-bold hover:bg-ink/10 active:scale-95 transition-transform"
            >
              −
            </button>
            <span className="flex-1 text-center text-2xl font-bold tabular-nums text-ink">
              {scoreA}
            </span>
            <button
              type="button"
              onClick={() => setScoreA((s) => s + 1)}
              className="w-10 h-10 border border-line bg-raised text-ink text-lg font-bold hover:bg-ink/10 active:scale-95 transition-transform"
            >
              +
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
            Score B
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScoreB((s) => Math.max(0, s - 1))}
              className="w-10 h-10 border border-line bg-raised text-ink text-lg font-bold hover:bg-ink/10 active:scale-95 transition-transform"
            >
              −
            </button>
            <span className="flex-1 text-center text-2xl font-bold tabular-nums text-ink">
              {scoreB}
            </span>
            <button
              type="button"
              onClick={() => setScoreB((s) => s + 1)}
              className="w-10 h-10 border border-line bg-raised text-ink text-lg font-bold hover:bg-ink/10 active:scale-95 transition-transform"
            >
              +
            </button>
          </div>
        </div>
      </div>
      )}
      <div className="flex gap-3 pt-1">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="px-4 py-3 border border-danger/40 text-danger font-semibold hover:bg-danger/10 active:scale-[0.98] transition-transform flex items-center gap-1.5"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 border border-line text-ink-dim font-semibold hover:bg-raised hover:text-ink active:scale-[0.98] transition-transform"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            onSubmit({
              team_a_name: teamA.trim(),
              team_b_name: teamB.trim(),
              // Edit mode: the score is the goal log's — send the server's
              // current values (refreshed after each goal add/edit/delete),
              // never the mount-time state.
              score_a: initial ? initial.score_a : scoreA,
              score_b: initial ? initial.score_b : scoreB,
            })
          }
          disabled={!canSubmit}
          className="flex-1 py-3 bg-ink text-board font-bold hover:bg-white/90 disabled:opacity-40 active:scale-[0.98] transition-transform"
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
        <div className="inline-flex items-center justify-center w-16 h-16 bg-team-a/15">
          <CheckCircle2
            className="h-9 w-9 text-team-a"
            aria-hidden
          />
        </div>
        <h2 className="text-xl font-bold text-ink">All matches complete</h2>
        <div className="inline-flex items-center gap-2 bg-raised px-4 py-1.5">
          <span className="text-sm font-semibold text-ink-dim tabular-nums">
            Final match: {lastMatch.team_a.name} {lastMatch.score_a} –{" "}
            {lastMatch.score_b} {lastMatch.team_b.name}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {completed.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between border border-line bg-panel px-4 py-3"
          >
            <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim tabular-nums">
              Match {m.match_number}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium tabular-nums text-ink">
                {m.team_a.name} {m.score_a}
              </span>
              <span className="text-ink-faint">—</span>
              <span className="text-sm font-medium tabular-nums text-ink">
                {m.score_b} {m.team_b.name}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────

export function RefereePage() {
  const { meetupId } = useParams<{ meetupId: string }>();
  const navigate = useNavigate();
  const { tokens } = useAuth();
  const auth = useContext(AuthContext);
  const isAdmin = auth?.me?.is_admin ?? false;
  const { showToast } = useToast();
  const sid = meetupId ? parseInt(meetupId, 10) : NaN;

  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [currentMatch, setCurrentMatch] = useState<MatchSummary | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const halfTimeTriggeredAt = useRef<number | null>(null);
  const prevRatioRef = useRef<number | null>(null);
  // Match id for which the final-whistle auto-end already fired (guards the
  // race between the local tick crossing zero and the SSE expiry event).
  const finalFiredForRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [confirmAction, setConfirmAction] = useState<
    | { kind: "end" }
    | { kind: "reset" }
    | { kind: "delete"; matchId: number }
    | null
  >(null);
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [editingMatch, setEditingMatch] = useState<MatchSummary | null>(null);
  const [halfTimeFlash, setHalfTimeFlash] = useState(false);
  const [meetupDetail, setMeetupDetail] = useState<MeetupDetail | null>(
    null,
  );
  const [teamsData, setTeamsData] = useState<TeamsResponse["teams"] | null>(
    null,
  );
  const [selectingTeams, setSelectingTeams] = useState(false);
  const [selectedTeamA, setSelectedTeamA] = useState(0);
  const [selectedTeamB, setSelectedTeamB] = useState(1);
  const [showSubstitutions, setShowSubstitutions] = useState(false);
  const [showReshape, setShowReshape] = useState(false);
  // Shared line-up accordion under the scoreboard band (default: closed).
  const [rostersOpen, setRostersOpen] = useState(false);
  const [goalSheet, setGoalSheet] = useState<{
    match: MatchSummary;
    goal: GoalRow | null;
  } | null>(null);
  // Goal log of the match being edited in the result form (fetched on demand).
  const [editingMatchGoals, setEditingMatchGoals] = useState<GoalRow[]>([]);

  // Steward gate / lease chip / goal log — fed by the ONE shared
  // meetup-data feed (see the hub subscription below). Any present member
  // may use the controls when the backend gate opens, not only admins.
  const { steward, lease, leaseLeft, goals, applyEvent, refreshGoals } =
    useStewardUi(sid, currentMatch?.id ?? null);

  // Goal log of the match being edited in the result form — fetched on
  // demand, and refetched whenever the editingMatch snapshot is refreshed
  // (after a goal is added/edited/deleted, the score rows stay truthful).
  useEffect(() => {
    if (!editingMatch) {
      setEditingMatchGoals([]);
      return;
    }
    let cancelled = false;
    void fetchGoals(sid, editingMatch.id)
      .then((rows) => {
        if (!cancelled) setEditingMatchGoals(rows);
      })
      .catch(() => {
        /* keep the previous snapshot */
      });
    return () => {
      cancelled = true;
    };
  }, [sid, editingMatch]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Drives deadline re-evaluation without waiting for SSE (see effect below).
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Deadline: 15 min after scheduled meetup end (computed from detail).
  const deadline = (() => {
    if (!meetupDetail?.start_time) return null;
    const start = parseMeetupStart(meetupDetail.start_time).getTime();
    const durationMin = meetupDetail.duration_minutes ?? 120;
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
      const res = await fetchMeetupMatches(sid);
      setMatches(res.matches);
      // Rosters change with substitutions — refresh so the non-playing
      // (bench) teams derived from teamsData stay correct.
      fetchMeetupTeams(sid).then((t) => setTeamsData(t.teams)).catch(() => {});
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
    fetchMeetupDetail(sid)
      .then(setMeetupDetail)
      .catch(() => {});
    fetchMeetupTeams(sid)
      .then((r) => setTeamsData(r.teams))
      .catch(() => {});
  }, [sid]);

  // SSE — rides the ONE existing meetup-data connection through the shared
  // hub (utils/meetupDataBus); no second EventSource here anymore.
  // Scoring types (goal_added / goal_removed / lease_acquired /
  // lease_released) go through the steward hook; timer types drive the
  // clock; on link (re)connect we refetch snapshots, never replay events.
  useEffect(() => {
    let wasLive = false; // hub pushes current status on subscribe
    return subscribeMeetupData(
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
      // Just crossed the 50% mark — half-time flash, double whistle, haptic
      halfTimeTriggeredAt.current = Date.now();
      setHalfTimeFlash(true);
      playHalfTimeWhistle();
      hapticHalfTime();
    }
  }, [timerSeconds, currentMatch, isPaused]);

  // Keep the half-time flash visible for 3 seconds
  useEffect(() => {
    if (!halfTimeFlash) return;
    const t = setTimeout(() => setHalfTimeFlash(false), 3000);
    return () => clearTimeout(t);
  }, [halfTimeFlash]);

  // iOS has no Web Vibration API: WebKit's native switch control plays the
  // system taptic tick when a real finger toggles it. Overlay an invisible
  // switch on every button so a tap lands on the control (click still
  // bubbles to the button). Runs after every render because React's
  // reconciliation can drop the DOM nodes we inject.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
      if (btn.disabled || btn.querySelector("input[data-tap-tick]")) return;
      if (getComputedStyle(btn).position === "static") btn.style.position = "relative";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.setAttribute("switch", "");
      inp.dataset.tapTick = "1";
      inp.tabIndex = -1;
      inp.setAttribute("aria-hidden", "true");
      Object.assign(inp.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        opacity: "0",
        margin: "0",
        padding: "0",
        border: "0",
        appearance: "none",
        cursor: "inherit",
      });
      // Reset outside the gesture so the re-check doesn't fire a second tick.
      inp.addEventListener("change", () => {
        requestAnimationFrame(() => {
          inp.checked = false;
        });
      });
      btn.appendChild(inp);
    });
  });

  // Re-sync with the server when the tab comes back into view
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadMatches();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadMatches]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label);
      try {
        await fn();
        await loadMatches();
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Request failed", "error");
      } finally {
        setBusy(null);
      }
    },
    [loadMatches, showToast],
  );

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

  const handleEndMatch = useCallback(() => {
    if (!currentMatch) return;
    // Ties end with the away team as de-facto winner (server decides; a draw
    // is recorded for stats only when the template allows it).
    void (async () => {
      await run("Ending match...", async () => {
        const res = await endMatch(sid, currentMatch.id);
        showToast(
          `Match ${currentMatch.match_number} over! Winner: ${res.winner_name}`,
          "success",
        );
      });
    })();
  }, [currentMatch, run, sid, showToast]);

  // Full-time: long whistle + haptic, and the match ends automatically.
  // Fires on the first render where an active/time_up match reads zero —
  // whether that comes from the local tick or the SSE expiry event.
  useEffect(() => {
    if (
      !currentMatch ||
      (currentMatch.status !== "active" && currentMatch.status !== "time_up")
    ) {
      finalFiredForRef.current = null;
      return;
    }
    if (finalFiredForRef.current === currentMatch.id) return;
    if (timerSeconds <= 0) {
      finalFiredForRef.current = currentMatch.id;
      playFinalWhistle();
      hapticFinal();
      handleEndMatch();
    }
  }, [timerSeconds, currentMatch, handleEndMatch]);

  const handleDeleteMatch = async (matchId: number) => {
    await run("Deleting...", async () => {
      await deleteMatch(sid, matchId);
      showToast("Match deleted", "success");
      setShowManualForm(false);
      setEditingMatch(null);
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

  // Goal sheet saved (new or edited): refresh the match list, and — when a
  // match is open in the result form — its snapshot so score + scorers stay
  // truthful.
  const handleGoalSaved = () => {
    void loadMatches();
    if (editingMatch) {
      void fetchMeetupMatches(sid).then((res) => {
        const fresh = res.matches.find((m) => m.id === editingMatch.id);
        if (fresh) setEditingMatch(fresh);
      });
    }
  };

  const handleGoalDeleted = async (g: GoalRow) => {
    const match = goalSheet?.match;
    if (!match) return;
    try {
      await deleteGoal(sid, match.id, g.id);
      setGoalSheet(null);
      handleGoalSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed", "error");
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

  // Reshape sheet: total confirmed count (the sheet only manages sizes).
  const reshapeTotalPlayers = useMemo(
    () =>
      (meetupDetail?.attendees ?? []).filter((a) => a.status === "confirmed")
        .length,
    [meetupDetail],
  );
  // Skill ratings by user id (from the meetup teams payload) — the match
  // roster snapshot doesn't carry skills.
  const skillById = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of teamsData ?? [])
      for (const p of t.players)
        m.set(Number(p.id), p.calculatedSkill ?? p.skillScore);
    return m;
  }, [teamsData]);

  if (!canControl) {
    const loading = steward == null;
    const line = loading
      ? "Loading steward state…"
      : steward.reason === "not_attending"
        ? "You're not marked as attending."
        : steward.reason === "outside_window"
          ? "Scoring is closed — you're outside the meetup window."
          : "Scoring controls unavailable.";
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-center">
        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-live" aria-hidden />
        )}
        <p className={loading ? "text-ink-dim" : "text-danger"}>{line}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-live" />
      </div>
    );
  }

  const completedMatches = matches.filter((m) => m.status === "completed");
  const pendingMatches = matches.filter((m) => m.status === "pending");

  // Meetup teams not in the current match — the substitution bench pool.
  const extraTeams =
    currentMatch && teamsData
      ? (() => {
          const inMatch = new Set([
            ...currentMatch.team_a.users,
            ...currentMatch.team_b.users,
          ].map((u) => u.id));
          return teamsData
            .filter(
              (t) => !t.players.some((p) => inMatch.has(Number(p.id))),
            )
            .map((t) => ({
              name: t.name,
              users: t.players.map((p) => ({
                id: Number(p.id),
                display_name: p.name,
              })),
            }));
        })()
      : [];
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
    <div
      ref={rootRef}
      className="min-h-screen bg-board"
      onClickCapture={(e) => {
        // Web Vibration (Android/desktop) on any button press; the switch
        // overlay above covers iOS.
        if ((e.target as HTMLElement).closest("button")) hapticLight();
      }}
    >
      {/* Header — painted scoreboard band */}
      <div className="sticky top-0 z-40 border-b border-line bg-board">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-2 px-2 pt-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="p-2 text-ink hover:bg-raised active:scale-95 transition-transform"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold text-ink leading-tight">
                Match Control
              </h1>
              <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim tabular-nums">
                {currentMatch
                  ? `Match ${currentMatch.match_number}`
                  : allComplete
                    ? "All matches done"
                    : "No active match"}
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowReshape(true)}
                className="p-2 text-ink hover:bg-raised active:scale-95 transition-transform"
                aria-label="Team settings"
              >
                <Settings className="h-5 w-5" />
              </button>
            )}
          </div>
          {currentMatch && (
            <div className="flex items-stretch mt-2">
              <button
                type="button"
                onClick={() => setRostersOpen((o) => !o)}
                aria-expanded={rostersOpen}
                aria-controls="match-rosters"
                className="flex flex-1 items-center justify-end gap-1 bg-team-a px-3 py-2 active:brightness-110"
              >
                <p className="max-w-full truncate text-base font-extrabold uppercase tracking-wide text-white sm:text-lg">
                  {currentMatch.team_a.name}
                </p>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-white/80 transition-transform ${
                    rostersOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden
                />
              </button>
              <div className="flex shrink-0 items-center gap-2 border-x border-line bg-board px-3">
                <span className="text-3xl font-extrabold tabular-nums text-ink">
                  {currentMatch.score_a}
                </span>
                <span className="text-base text-ink-faint">—</span>
                <span className="text-3xl font-extrabold tabular-nums text-ink">
                  {currentMatch.score_b}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setRostersOpen((o) => !o)}
                aria-expanded={rostersOpen}
                aria-controls="match-rosters"
                className="flex flex-1 items-center justify-start gap-1 bg-team-b px-3 py-2 active:brightness-110"
              >
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-white/80 transition-transform ${
                    rostersOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden
                />
                <p className="max-w-full truncate text-base font-extrabold uppercase tracking-wide text-white sm:text-lg">
                  {currentMatch.team_b.name}
                </p>
              </button>
            </div>
          )}
          {currentMatch && rostersOpen && (
            <div
              id="match-rosters"
              className="mt-2 flex items-start justify-between gap-3 border border-line bg-raised px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-team-a">
                  {currentMatch.team_a.name} · {currentMatch.team_a.users.length}
                </p>
                <ul className="mt-1 text-sm text-ink">
                  {sortRosterBySkill(currentMatch.team_a.users, skillById).map(
                    (u) => (
                      <li
                        key={u.id}
                        className="flex min-w-0 items-baseline gap-1.5"
                      >
                        <span className="truncate">{u.display_name}</span>
                        <span className="shrink-0 text-2xs tabular-nums text-ink-faint">
                          {skillLabel(skillById.get(u.id))}
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
              <div className="min-w-0">
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-right text-team-b">
                  {currentMatch.team_b.name} · {currentMatch.team_b.users.length}
                </p>
                <ul className="mt-1 text-sm text-ink">
                  {sortRosterBySkill(currentMatch.team_b.users, skillById).map(
                    (u) => (
                      <li
                        key={u.id}
                        className="flex min-w-0 items-baseline justify-end gap-1.5"
                      >
                        <span className="truncate">{u.display_name}</span>
                        <span className="shrink-0 text-2xs tabular-nums text-ink-faint">
                          {skillLabel(skillById.get(u.id))}
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {isPastDeadline ? (
          /* Locked — past deadline */
          <div className="space-y-4">
            <div className="text-center space-y-2 py-4">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-raised">
                <CheckCircle2
                  className="h-7 w-7 text-ink-dim"
                  aria-hidden
                />
              </div>
              <div>
                <h2 className="text-lg font-bold text-ink-dim">
                  Meetup closed
                </h2>
                <p className="text-xs text-ink-faint mt-0.5">
                  Locked 15 min after meetup end
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
            goals={editingMatch ? editingMatchGoals : undefined}
            onAddGoal={
              editingMatch
                ? () => setGoalSheet({ match: editingMatch, goal: null })
                : undefined
            }
            onEditGoal={
              editingMatch
                ? (g) => setGoalSheet({ match: editingMatch, goal: g })
                : undefined
            }
          />
        ) : allComplete && selectingTeams ? (
          /* Team selection for new match */
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-bold text-ink">
                Pick your teams
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                  Team A
                </label>
                <div className="relative">
                  <select
                    value={selectedTeamA}
                    onChange={(e) => setSelectedTeamA(Number(e.target.value))}
                    className="w-full appearance-none border border-line bg-raised px-4 py-3 pr-8 text-sm font-medium text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
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
                  <ChevronDown className="absolute right-3 bottom-3 h-4 w-4 text-ink-faint pointer-events-none" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                  Team B
                </label>
                <div className="relative">
                  <select
                    value={selectedTeamB}
                    onChange={(e) => setSelectedTeamB(Number(e.target.value))}
                    className="w-full appearance-none border border-line bg-raised px-4 py-3 pr-8 text-sm font-medium text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
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
                  <ChevronDown className="absolute right-3 bottom-3 h-4 w-4 text-ink-faint pointer-events-none" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectingTeams(false)}
                className="flex-1 py-3 border border-line text-ink-dim font-semibold hover:bg-raised hover:text-ink active:scale-[0.98] transition-transform"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleStartNewMatch()}
                disabled={busy !== null || selectedTeamA === selectedTeamB}
                className="flex-1 py-3 bg-ink text-board font-bold hover:bg-white/90 disabled:opacity-40 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                <Play className="h-4 w-4" />
                Start match
              </button>
            </div>
          </div>
        ) : allComplete ? (
          /* All matches done but deadline not passed — offer to add more */
          <div className="text-center space-y-6 py-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-team-a/15">
              <CheckCircle2
                className="h-7 w-7 text-team-a"
                aria-hidden
              />
            </div>
            <h2 className="text-xl font-bold text-ink">
              {completedMatches.length} match
              {completedMatches.length !== 1 ? "es" : ""} recorded
            </h2>
            <div className="flex flex-col gap-3 items-center">
              <button
                type="button"
                onClick={() => setSelectingTeams(true)}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-8 py-4 bg-ink text-board text-lg font-bold hover:bg-white/90 disabled:opacity-50 active:scale-[0.98] transition-transform min-h-[56px]"
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
                className="inline-flex items-center gap-2 px-8 py-4 bg-ink text-board text-lg font-bold hover:bg-white/90 active:scale-[0.98] transition-transform min-h-[56px]"
              >
                <Plus className="h-5 w-5" />
                Add match result
              </button>
            </div>
          </div>
        ) : !currentMatch ? (
          /* No match started yet */
          <div className="text-center space-y-6 py-12">
            <Flag className="h-16 w-16 mx-auto text-ink-faint" />
            <h2 className="text-xl font-bold text-ink">Ready to start?</h2>
            {teamsData && teamsData.length > 2 ? (
              <div className="space-y-4 max-w-sm mx-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 text-left">
                    <label className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                      Team A
                    </label>
                    <div className="relative">
                      <select
                        value={selectedTeamA}
                        onChange={(e) =>
                          setSelectedTeamA(Number(e.target.value))
                        }
                        className="w-full appearance-none border border-line bg-raised px-4 py-3 pr-8 text-sm font-medium text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
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
                      <ChevronDown className="absolute right-3 bottom-3 h-4 w-4 text-ink-faint pointer-events-none" />
                    </div>
                  </div>
                  <div className="space-y-1.5 text-left">
                    <label className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                      Team B
                    </label>
                    <div className="relative">
                      <select
                        value={selectedTeamB}
                        onChange={(e) =>
                          setSelectedTeamB(Number(e.target.value))
                        }
                        className="w-full appearance-none border border-line bg-raised px-4 py-3 pr-8 text-sm font-medium text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
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
                      <ChevronDown className="absolute right-3 bottom-3 h-4 w-4 text-ink-faint pointer-events-none" />
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
                  className="inline-flex items-center gap-2 px-8 py-4 bg-live text-board text-lg font-bold hover:bg-live/90 disabled:opacity-50 active:scale-[0.98] transition-transform min-h-[56px]"
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
                className="inline-flex items-center gap-2 px-8 py-4 bg-live text-board text-lg font-bold hover:bg-live/90 disabled:opacity-50 active:scale-[0.98] transition-transform min-h-[56px]"
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
            {/* TV-style goal list — directly below the score; hidden until a
                goal is logged; tap a goal to open the sheet in edit mode
                (delete lives inside the sheet). */}
            {goals.length > 0 && (
              <div className="border border-line bg-panel px-4 py-2">
                <GoalList
                  goals={goals}
                  canEdit={canControl}
                  onEdit={(g) => setGoalSheet({ match: currentMatch, goal: g })}
                />
              </div>
            )}

            {/* Parallel pending matches (4+ teams) — pick which one to run. */}
            {currentMatch.status === "pending" && pendingMatches.length > 1 && (
              <div className="space-y-2">
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                  Pending matches
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {pendingMatches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setCurrentMatch(m);
                        setTimerSeconds(m.timer_total_seconds);
                        setIsPaused(false);
                      }}
                      className={`py-3 text-sm font-semibold border active:scale-[0.98] transition-transform min-h-[48px] ${
                        m.id === currentMatch.id
                          ? "border-live text-live bg-live/10"
                          : "border-line text-ink-dim hover:bg-raised hover:text-ink"
                      }`}
                    >
                      Match {m.match_number}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Pre-start substitutions — admin only, hidden while a match runs */}
            {currentMatch.status === "pending" && isAdmin && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setShowSubstitutions((v) => !v)}
                  className="w-full py-3 border border-line text-ink-dim font-semibold hover:bg-raised hover:text-ink active:scale-[0.98] transition-transform flex items-center justify-center gap-2 min-h-[48px]"
                  aria-expanded={showSubstitutions}
                >
                  {showSubstitutions ? (
                    <X className="h-4 w-4" aria-hidden />
                  ) : (
                    <ArrowRightLeft className="h-4 w-4" aria-hidden />
                  )}
                  Substitutions
                </button>
                {showSubstitutions && (
                  <SubstitutionsPanel
                    key={currentMatch.id}
                    meetupId={sid}
                    match={currentMatch}
                    extraTeams={extraTeams}
                    onSaved={() => void loadMatches()}
                  />
                )}
              </div>
            )}

            {/* Clock — teams + score live in the painted header band */}
            <div className="border border-line bg-panel p-4 space-y-3">
              {/* Half-time flash */}
              {halfTimeFlash && (
                <div className="text-center py-2 px-4 bg-live text-board text-lg font-bold animate-pulse">
                  ⚡ Half-time!
                </div>
              )}

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
                  <p className="text-sm font-medium text-ink-dim mt-1">
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
                className="w-full py-5 bg-live text-board text-xl font-bold hover:bg-live/90 disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-3 min-h-[56px]"
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
                className="w-full py-5 bg-live text-board text-xl font-bold hover:bg-live/90 disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-3 min-h-[56px]"
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
                className="w-full py-5 bg-live text-board text-xl font-bold hover:bg-live/90 disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-3 min-h-[56px]"
              >
                <Play className="h-6 w-6" />
                Resume
              </button>
            )}

            {/* + Goal — the goal-recording sheet (lease-gated, per match). */}
            {currentMatch.status !== "time_up" && (
              <button
                type="button"
                disabled={(!!lease && leaseLeft > 0) || busy !== null}
                onClick={() => setGoalSheet({ match: currentMatch, goal: null })}
                className="w-full py-4 bg-ink text-board text-lg font-bold hover:bg-white/90 disabled:opacity-60 active:scale-[0.98] transition-transform flex items-center justify-center gap-2 min-h-[56px]"
              >
                {lease && leaseLeft > 0
                  ? leaseBusyLabel(lease.holderName, leaseLeft)
                  : "+ Goal"}
              </button>
            )}

            {/* Score is driven by the goal log — the ±steppers are gone. */}

            {/* End match — neutral: finishing is routine, not destructive */}
            <button
              type="button"
              onClick={() => setConfirmAction({ kind: "end" })}
              disabled={busy !== null}
              className="w-full py-5 border-2 border-ink/30 text-ink text-xl font-bold hover:bg-raised disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-3 min-h-[56px]"
            >
              <Flag className="h-6 w-6" />
              End Match
            </button>

            {/* Reset / Delete — borderless, side by side */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() =>
                  currentMatch && setConfirmAction({ kind: "reset" })
                }
                disabled={busy !== null}
                className="flex-1 py-3 text-ink-dim text-sm font-semibold hover:bg-raised hover:text-ink disabled:opacity-40 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
              <button
                type="button"
                onClick={() =>
                  currentMatch &&
                  setConfirmAction({ kind: "delete", matchId: currentMatch.id })
                }
                disabled={busy !== null}
                className="flex-1 py-3 text-danger text-sm font-semibold hover:bg-danger/10 disabled:opacity-40 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>

            {/* Next match preview */}
            {nextMatch && (
              <div className="border border-line bg-raised p-4 space-y-1">
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                  Next match
                </p>
                <p className="text-base text-ink">
                  {nextMatch.team_a.name} vs {nextMatch.team_b.name}
                </p>
              </div>
            )}
          </>
        )}

        {/* Past matches */}
        {completedMatches.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
              Completed matches
            </h3>
            {completedMatches.map((m) => {
              const hasWinner = m.score_a !== m.score_b;
              return (
                <div
                  key={m.id}
                  className={`flex items-center justify-between border border-line px-4 py-3 gap-2 ${
                    hasWinner ? "bg-raised" : "bg-panel"
                  }`}
                >
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim tabular-nums">
                      Match {m.match_number}
                    </span>
                    {m.was_draw && (
                      <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint border border-line px-1 py-0.5">
                        Draw
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold truncate">
                      <span className="text-team-a">{m.team_a.name}</span>{" "}
                      <span className="tabular-nums text-ink">
                        {m.score_a}
                      </span>
                    </span>
                    <span className="text-ink-faint shrink-0">—</span>
                    <span className="text-sm font-semibold truncate">
                      <span className="tabular-nums text-ink">
                        {m.score_b}
                      </span>{" "}
                      <span className="text-team-b">{m.team_b.name}</span>
                    </span>
                  </div>
                  {!isPastDeadline && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMatch(m);
                        setShowManualForm(true);
                      }}
                      className="p-1.5 hover:bg-raised shrink-0"
                      aria-label={`Edit match ${m.match_number}`}
                    >
                      <Edit className="h-4 w-4 text-ink-faint hover:text-ink" />
                    </button>
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

      {/* Goal recording / editing sheet — lease-gated, scoped to one match */}
      {goalSheet && (
        <GoalEntrySheet
          meetupId={sid}
          match={goalSheet.match}
          editGoal={goalSheet.goal}
          onClose={() => setGoalSheet(null)}
          onLogged={() => {
            handleGoalSaved();
          }}
          onDeleteGoal={
            goalSheet.goal ? (g) => void handleGoalDeleted(g) : undefined
          }
        />
      )}

      {/* Mid-meetup team reshape — admin only, from the header gear */}
      {isAdmin && (
        <TeamReshapeSheet
          open={showReshape}
          meetupId={sid}
          totalPlayers={reshapeTotalPlayers}
          currentTeamCount={teamsData?.length ?? 2}
          liveMatchNumber={
            matches.find((m) => m.status === "active")?.match_number ?? null
          }
          onClose={() => setShowReshape(false)}
          onSaved={() => {
            setShowReshape(false);
            void loadMatches();
            showToast("Teams updated", "success");
          }}
        />
      )}
    </div>
  );
}
