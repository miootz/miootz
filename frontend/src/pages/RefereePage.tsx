import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../auth/useAuth";
import { matchControlWindow } from "../utils/datetime";
import {
  fetchMeetupMatches,
  startMatches,
  createMatch,
  createNewPendingMatch,
  startTimer,
  pauseTimer,
  adjustTimer,
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
import { MobileSheet } from "../components/MobileSheet";
import { leaseBusyButtonLabel } from "../utils/lease";
import { hapticFinal, hapticHalfTime, hapticLight } from "../utils/haptics";
import { playFinalWhistle, playHalfTimeWhistle, previewWhistle, releaseWhistles, unlockWhistles } from "../utils/whistle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SubstitutionsPanel } from "../components/SubstitutionsPanel";
import { PenaltyShootoutPanel } from "../components/PenaltyShootoutPanel";
import { TeamReshapeSheet } from "../components/TeamReshapeSheet";
import { SkillRating } from "../components/SkillRating";
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
  Settings,
  Trash2,
  WifiOff,
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

// ── Manual Match Form ────────────────────────────────────────────

function ManualMatchForm({
  onSubmit,
  onCancel,
  onDelete,
  existingTeamNames,
  initial,
  goals = [],
  goalsLocked = false,
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
  goalsLocked?: boolean;
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
            <GoalList goals={goals} canEdit={!!onEditGoal} onEdit={(g) => onEditGoal?.(g)} />
          </div>
          {goalsLocked && (
            <p className="text-sm text-ink-dim">
              Goals are locked after a shootout. An admin can delete and re-record this match to correct the result.
            </p>
          )}
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
            aria-label="Delete match"
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
          {goalsLocked ? "Done" : "Cancel"}
        </button>
        {!goalsLocked && <button
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
        </button>}
      </div>
    </div>
  );
}

// ── Final Standings ──────────────────────────────────────────────

function FinalStandings({ matches }: { matches: MatchSummary[] }) {
  const completed = matches.filter((m) => m.status === "completed");
  if (completed.length === 0) return null;

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
      </div>

      <div className="space-y-2">
        {completed.map((m) => (
          <div
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border border-line bg-panel px-4 py-3"
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
            {m.penalty_winner && (
              <p className="basis-full w-full text-xs text-ink-dim tabular-nums text-right">
                Shootout: {m.penalty_score_a != null && m.penalty_score_b != null && <>{m.penalty_score_a} – {m.penalty_score_b} — </>}
                {m.penalty_winner === "a" ? m.team_a.name : m.team_b.name} wins
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────

export function RefereePage() {
  const { meetupId, matchId } = useParams<{ meetupId: string; matchId?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pitchParam = searchParams.get("pitch");
  const selectedPitch = pitchParam === "1" ? 1 : pitchParam === "2" ? 2 : null;
  const routeMatchId = matchId ? Number.parseInt(matchId, 10) : null;
  const { tokens } = useAuth();
  const auth = useContext(AuthContext);
  const isAdmin = auth?.me?.is_admin ?? false;
  const { showToast } = useToast();
  const sid = meetupId ? parseInt(meetupId, 10) : NaN;

  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [twoPitch, setTwoPitch] = useState(false);
  const [currentMatch, setCurrentMatch] = useState<MatchSummary | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  // A tied first match goes to penalties — the panel shows automatically
  // (also on reload mid-shootout; keep a locked result visible until dismissed).
  const [penaltyMatch, setPenaltyMatch] = useState<MatchSummary | null>(null);
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
  // Set after a match is deleted: the referee should get the same "Start new
  // match" entry point as after ending one — not the "ready to start?" state.
  const [matchDeleted, setMatchDeleted] = useState(false);
  const [showSubstitutions, setShowSubstitutions] = useState(false);
  const [showReshape, setShowReshape] = useState(false);
  // Shared line-up accordion under the scoreboard band (default: closed).
  const [rostersOpen, setRostersOpen] = useState(true);
  const [goalSheet, setGoalSheet] = useState<{
    match: MatchSummary;
    goal: GoalRow | null;
  } | null>(null);
  // Goal log of the match being edited in the result form (fetched on demand).
  const [editingMatchGoals, setEditingMatchGoals] = useState<GoalRow[]>([]);

  // Steward gate / lease chip / goal log — fed by the ONE shared
  // meetup-data feed (see the hub subscription below). Any present member
  // may use the controls when the backend gate opens, not only admins.
  const { steward, lease, leaseLeft, goals, misses, applyEvent, refreshGoals } =
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
  const [sseLive, setSseLive] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Deadline: 15 min after scheduled meetup end (computed from detail).
  const deadline = (() => {
    if (!meetupDetail?.start_time) return null;
    return matchControlWindow(meetupDetail.start_time, meetupDetail.duration_minutes).closesAt;
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

  const matchLoadRef = useRef<{
    sid: number;
    pending: boolean;
    running: Promise<void> | null;
    teamVersion: number;
  } | null>(null);
  const loadMatches = useCallback(() => {
    let load = matchLoadRef.current;
    if (!load || load.sid !== sid) {
      load = { sid, pending: false, running: null, teamVersion: 0 };
      matchLoadRef.current = load;
    }
    if (load.running) {
      load.pending = true;
      return load.running;
    }

    const current = load;
    current.running = (async () => {
      try {
        do {
          current.pending = false;
          // Rosters can change independently of the matches during substitutions.
          const teamVersion = ++current.teamVersion;
          void fetchMeetupTeams(sid).then((teams) => {
            if (matchLoadRef.current === current && teamVersion === current.teamVersion) {
              setTeamsData(teams.teams);
            }
          }).catch(() => {});
          try {
            const res = await fetchMeetupMatches(sid);
            if (matchLoadRef.current !== current) return;
            setMatches(res.matches);
            setTwoPitch(!!res.two_pitch);
            setEditingMatch((editing) =>
              editing ? res.matches.find((m) => m.id === editing.id) ?? editing : null,
            );
            const routeMatch = routeMatchId != null
              ? res.matches.find(
                  (m) => m.id === routeMatchId && m.status !== "completed",
                )
              : undefined;
            const active = res.matches.find(
              (m) => m.status === "active" || m.status === "time_up",
            );
            const pending = res.matches.find((m) => m.status === "pending");
            const chosen = selectedPitch !== null
              ? res.matches.find((m) => (m.pitch ?? 1) === selectedPitch && m.status !== "completed") ?? null
              : !res.two_pitch || routeMatchId == null ? active ?? pending ?? null : routeMatch ?? null;
            if (chosen) {
              setCurrentMatch(chosen);
              setTimerSeconds(
                chosen.status === "pending"
                  ? chosen.timer_total_seconds
                  : chosen.timer_seconds_remaining,
              );
              setIsPaused(chosen.timer_paused);
              setTimerEndsAt(
                chosen.timer_ends_at ? Date.parse(chosen.timer_ends_at) : null,
              );
            } else {
              setCurrentMatch(null);
              setTimerSeconds(0);
              setIsPaused(false);
              setTimerEndsAt(null);
            }
            // Resume an interrupted shootout with no locked winner.
            const shoot = res.matches.find(
              (m) =>
                m.status === "completed" &&
                (selectedPitch !== null
                  ? (m.pitch ?? 1) === selectedPitch
                  : !res.two_pitch || routeMatchId == null || m.id === routeMatchId) &&
                m.match_number === 1 &&
                m.score_a === m.score_b &&
                m.penalty_winner == null &&
                !m.penalty_skipped,
            );
            setPenaltyMatch((open) => shoot ?? (open
              ? res.matches.find((m) => m.id === open.id && m.penalty_winner != null) ?? null
              : null));
          } catch (e) {
            if (matchLoadRef.current === current) {
              showToast(
                e instanceof Error ? e.message : "Failed to load matches",
                "error",
              );
            }
          } finally {
            if (matchLoadRef.current === current) setLoading(false);
          }
        } while (current.pending && matchLoadRef.current === current);
      } finally {
        current.running = null;
      }
    })();
    return current.running;
  }, [sid, routeMatchId, selectedPitch, showToast]);

  const liveRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLiveRefresh = useCallback(() => {
    if (liveRefreshRef.current !== null) return;
    liveRefreshRef.current = setTimeout(() => {
      liveRefreshRef.current = null;
      void loadMatches();
    }, 100);
  }, [loadMatches]);

  useEffect(() => () => {
    if (liveRefreshRef.current) clearTimeout(liveRefreshRef.current);
    liveRefreshRef.current = null;
  }, [loadMatches]);

  useEffect(() => () => {
    if (matchLoadRef.current?.sid === sid) matchLoadRef.current = null;
  }, [sid]);

  useEffect(() => {
    void loadMatches();
  }, [loadMatches]);

  useEffect(() => {
    if (isNaN(sid)) return;
    fetchMeetupDetail(sid)
      .then(setMeetupDetail)
      .catch(() => {});
  }, [sid]);

  const stewardEvents = useRef({ applyEvent, refreshGoals, matchId: currentMatch?.id });
  useEffect(() => {
    stewardEvents.current = { applyEvent, refreshGoals, matchId: currentMatch?.id };
  }, [applyEvent, refreshGoals, currentMatch?.id]);

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
        if (stewardEvents.current.applyEvent(data)) {
          if (data.type === "goal_added" || data.type === "goal_removed" || data.type === "goal_updated" || data.type === "penalty_missed" || data.type === "penalty_miss_removed") {
            scheduleLiveRefresh();
          }
          return;
        }
        if (typeof data.type === "string" && data.type.startsWith("match_timer_") &&
            data.match_id !== stewardEvents.current.matchId) return;
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
            scheduleLiveRefresh();
            break;
          case "meetup_updated":
            scheduleLiveRefresh();
            void fetchMeetupDetail(sid).then(setMeetupDetail).catch(() => {});
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
            scheduleLiveRefresh();
            break;
          case "match_ended":
          case "match_created":
          case "match_reset":
          case "match_score_updated":
          case "match_penalty_shots":
          case "match_penalty_finished":
            scheduleLiveRefresh();
            break;
        }
      },
      (live) => {
        setSseLive(live);
        if (live && !wasLive) {
          // (Re)connected after a gap — refetch snapshots, never replay.
          if (liveRefreshRef.current) clearTimeout(liveRefreshRef.current);
          liveRefreshRef.current = null;
          void loadMatches();
          void stewardEvents.current.refreshGoals();
        }
        wasLive = live;
      },
    );
  }, [sid, loadMatches, scheduleLiveRefresh, tokens?.accessToken]);

  useEffect(() => () => releaseWhistles(), []);

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
      // Just crossed the 50% mark — half-time flash, whistle, haptic
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
      const res = await startMatches(sid, selectedPitch === null ? body : { ...body, pitch: selectedPitch });
      const both = res.matches?.length ?? 1;
      showToast(
        `${selectedPitch !== null ? `Pitch ${selectedPitch} ready` : both === 2 ? "Both pitches ready" : "Match ready"}: ${res.match.team_a.name} vs ${res.match.team_b.name}`,
        "success",
      );
    });
  };

  const handleStartTimer = async () => {
    if (!currentMatch) return;
    unlockWhistles();
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

  const handleAdjustTimer = async (delta: -15 | 15) => {
    if (!currentMatch) return;
    await run("Adjusting timer...", async () => {
      const res = await adjustTimer(sid, currentMatch.id, delta);
      setTimerSeconds(res.seconds_remaining);
    });
  };

  const handleResumeTimer = async () => {
    if (!currentMatch) return;
    unlockWhistles();
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

  const handleEndMatch = useCallback(
    ({ skipNextMatch = false }: { skipNextMatch?: boolean } = {}) => {
      if (!currentMatch) return;
      // Ties end with the away team as de-facto winner (server decides; a draw
      // is recorded for stats only when the template allows it).
      void (async () => {
        await run("Ending match...", async () => {
          const res = await endMatch(sid, currentMatch.id, undefined, skipNextMatch);
          showToast(
            `Match ${currentMatch.match_number} over! Winner: ${res.winner_name}`,
            "success",
          );
        });
      })();
    },
    [currentMatch, run, sid, showToast],
  );

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
    if (isPaused || finalFiredForRef.current === currentMatch.id) return;
    if (timerSeconds <= 0) {
      finalFiredForRef.current = currentMatch.id;
      playFinalWhistle();
      hapticFinal();
      handleEndMatch();
    }
  }, [timerSeconds, currentMatch, isPaused, handleEndMatch]);

  const handleDeleteMatch = async (matchId: number) => {
    await run("Deleting...", async () => {
      await deleteMatch(sid, matchId);
      showToast("Match deleted", "success");
      setShowManualForm(false);
      setEditingMatch(null);
      setMatchDeleted(true);
    });
  };

  // Dispatch the pending destructive/confirmable action
  const handleConfirmAction = async () => {
    const action = confirmAction;
    if (!action) return;
    setConfirmAction(null);
    if (action.kind === "end") {
      handleEndMatch({ skipNextMatch: true });
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
        setMatchDeleted(false);
      });
    } else {
      await run("Saving...", async () => {
        await createMatch(sid, body);
        showToast("Match result saved", "success");
        setShowManualForm(false);
        setMatchDeleted(false);
      });
    }
  };

  // Goal sheet saved (new or edited): refresh the match list, and — when a
  // match is open in the result form — its snapshot so score + scorers stay
  // truthful.
  const handleGoalSaved = () => {
    scheduleLiveRefresh();
    void refreshGoals();
  };

  const handleGoalDeleted = async (g: GoalRow) => {
    const match = goalSheet?.match;
    if (!match) return;
    await deleteGoal(sid, match.id, g.id);
    handleGoalSaved();
  };

  const handleStartNewMatch = async (useBracket = false) => {
    await run("Creating match...", async () => {
      if (matches.length === 0) {
        // No completed match to build from (e.g. the only match was just
        // deleted) — start the schedule from scratch with the picked teams.
        const res = await startMatches(sid, {
          team_a_idx: selectedTeamA,
          team_b_idx: selectedTeamB,
        });
        showToast(
          `Matches started! ${res.match.team_a.name} vs ${res.match.team_b.name}`,
          "success",
        );
      } else {
        const { match } = await createNewPendingMatch(sid, useBracket ? undefined : {
          team_a_idx: selectedTeamA,
          team_b_idx: selectedTeamB,
        });
        if (twoPitch && (routeMatchId != null || selectedPitch !== null)) navigate(`/meetup-matches/${sid}/${match.id}`);
        showToast("New match ready — start the timer!", "success");
      }
      setSelectingTeams(false);
      setMatchDeleted(false);
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
      <div className="flex flex-col items-center gap-2 p-6 text-center">
        <div className="flex items-center gap-2">
          {loading && (
            <Loader2 className="h-4 w-4 animate-spin text-live" aria-hidden />
          )}
          <p className={loading ? "text-ink-dim" : "text-danger"}>{line}</p>
        </div>
        <Link
          to={isAdmin ? "/admin" : "/"}
          className="inline-flex min-h-[44px] items-center gap-2 px-3 text-sm font-semibold text-ink underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {isAdmin ? "Back to admin overview" : "Back to meetup"}
        </Link>
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

  const playingTeams = teamsData?.slice(0, meetupDetail?.max_teams ?? undefined);

  // Meetup teams not in the current match — the substitution bench pool.
  const extraTeams =
    currentMatch && teamsData
      ? (() => {
          const inMatch = new Set([
            ...currentMatch.team_a.users,
            ...currentMatch.team_b.users,
          ].map((u) => u.id));
          const inAnotherMatch = new Set(matches
            .filter((m) => m.id !== currentMatch.id && m.status !== "completed")
            .flatMap((m) => [...m.team_a.users, ...m.team_b.users].map((u) => u.id)));
          return teamsData
            .map((t, index) => ({
              name: meetupDetail?.max_teams != null && index >= meetupDetail.max_teams ? "Bench" : t.name,
              users: t.players.filter((p) => !inMatch.has(Number(p.id))).map((p) => ({
                id: Number(p.id),
                display_name: p.name,
                pac: p.pac,
                dri: p.dri,
                inAnotherMatch: inAnotherMatch.has(Number(p.id)),
              })),
            }))
            .filter((t) => t.users.length > 0);
        })()
      : [];
  const allComplete =
    matches.length > 0 &&
    matches.every((m) => m.status === "completed") &&
    !currentMatch;
  // After a delete, the referee gets the same "Start new match" entry point
  // the all-complete state offers — even with an empty match list.
  const canPrepareSelectedPitch = selectedPitch !== null
    && (playingTeams?.filter((team) => team.players.length > 0).length ?? 0) >= 4
    && !matches.some((m) => (m.pitch ?? 1) === selectedPitch)
    && matches.every((m) => m.match_number <= 2);
  const showStartNewMatch =
    !canPrepareSelectedPitch && (allComplete || (matchDeleted && matches.length === 0));
  const firstShootoutPending = matches.some((m) =>
    m.match_number === 1 && m.status === "completed" &&
    m.score_a === m.score_b && !m.penalty_winner && !m.penalty_skipped
  );

  // Show next match preview after a match ended
  const nextMatch = !twoPitch && matches.find(
    (m) =>
      m.status === "pending" &&
      m.match_number > (currentMatch?.match_number || 0),
  );

  // Bottom action deck only exists for live controls — no deck in the other states.
  const kickoffBlocked = firstShootoutPending && !(twoPitch && currentMatch?.pitch === 2);
  const shootoutOpen = penaltyMatch !== null && !isPastDeadline;
  const showCompleted = showStartNewMatch && !showManualForm && !selectingTeams && !shootoutOpen && !isPastDeadline;
  const liveControls =
    currentMatch && !isPastDeadline && !showManualForm && !showStartNewMatch && !selectingTeams && !shootoutOpen;

  return (
    <div
      ref={rootRef}
      className={`flex flex-1 min-h-0 flex-col bg-board ${liveControls ? "referee-workspace" : ""}`}
      onClickCapture={(e) => {
        // Web Vibration (Android/desktop) on any button press; the switch
        // overlay above covers iOS.
        if ((e.target as HTMLElement).closest("button")) {
          unlockWhistles();
          hapticLight();
        }
      }}
    >
      {/* Header — painted scoreboard band */}
      <div className="referee-header shrink-0 border-b border-line bg-board">
        <div className="referee-header-inner max-w-lg mx-auto tablet:max-w-2xl">
          <div className="referee-match-bar flex items-center gap-2 px-2 pt-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="p-2 text-ink hover:bg-raised active:scale-95 transition-transform"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="flex items-center gap-2 text-sm font-bold text-ink leading-tight">
                {selectedPitch === null ? "Match Control" : `Pitch ${selectedPitch} · Match Control`}
                {sseLive ? (
                  <span className="relative inline-block h-2 w-2" aria-hidden>
                    <span className="absolute inset-0 motion-safe:animate-ping motion-reduce:animate-none bg-live opacity-75" />
                    <span className="relative block h-2 w-2 bg-live" />
                  </span>
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
                )}
              </h1>
              <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim tabular-nums">
                {currentMatch
                  ? `Match ${currentMatch.match_number}`
                  : showStartNewMatch
                    ? "All matches done"
                    : "No active match"}
              </p>
            </div>
            {liveControls && (
              <button
                type="button"
                onClick={previewWhistle}
                aria-label="Test whistle"
                className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink tablet:px-3"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <path d="M21 5h-9l-2 3H8a6 6 0 1 0 6 6v-2l7-3z" />
                  <circle cx="8" cy="14" r="2" />
                  <path d="M2 4l2 2M6 2l1 3" />
                </svg>
                <span className="hidden tablet:inline">Test whistle</span>
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowReshape(true)}
                disabled={!meetupDetail || !teamsData}
                className="grid h-11 w-11 place-items-center text-ink hover:bg-raised disabled:opacity-50"
                aria-label="Team settings"
                aria-haspopup="dialog"
              >
                <Settings className="h-5 w-5" />
              </button>
            )}
          </div>
          {currentMatch && (
            <div className="referee-scoreboard mt-2">
              <p className="referee-score texture-painted-steel flex items-center justify-center py-1 text-center text-4xl font-extrabold leading-none tabular-nums text-ink tablet:py-3 tablet:text-5xl">
                {currentMatch.score_a}
                <span className="mx-3 h-0.5 w-6 bg-ink-faint text-[0px]">—</span>
                {currentMatch.score_b}
              </p>
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => setRostersOpen((o) => !o)}
                  aria-expanded={rostersOpen && !shootoutOpen}
                  disabled={shootoutOpen}
                  aria-controls="match-rosters"
                  className="flex min-w-0 flex-1 items-center justify-center gap-1 bg-team-a px-3 py-2 active:brightness-110 tablet:min-h-12"
                >
                  <p className="max-w-full truncate text-sm font-extrabold uppercase tracking-wide text-white">
                    {currentMatch.team_a.name}
                  </p>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-white/80 transition-transform ${
                      rostersOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setRostersOpen((o) => !o)}
                  aria-expanded={rostersOpen && !shootoutOpen}
                  disabled={shootoutOpen}
                  aria-controls="match-rosters"
                  className="flex min-w-0 flex-1 items-center justify-center gap-1 bg-team-b px-3 py-2 active:brightness-110 tablet:min-h-12"
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-white/80 transition-transform ${
                      rostersOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden
                  />
                  <p className="max-w-full truncate text-sm font-extrabold uppercase tracking-wide text-white">
                    {currentMatch.team_b.name}
                  </p>
                </button>
              </div>
            </div>
          )}
          {currentMatch && rostersOpen && !shootoutOpen && (
            <div
              id="match-rosters"
              className="referee-rosters mt-2 flex items-start justify-between gap-3 border border-line bg-raised px-3 py-2"
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
                        {skillById.has(u.id) && (
                          <SkillRating score={skillById.get(u.id)} className="text-2xs text-ink-dim" />
                        )}
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
                        {skillById.has(u.id) && (
                          <SkillRating score={skillById.get(u.id)} className="text-2xs text-ink-dim" />
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="referee-activity relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        <div className={`referee-activity-inner mx-auto max-w-lg px-4 py-4 tablet:max-w-2xl ${showCompleted && completedMatches.length > 0 ? "desktop:grid desktop:max-w-5xl desktop:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] desktop:items-start desktop:gap-8" : ""}`}>
        <div className="space-y-6">
        {shootoutOpen && penaltyMatch ? (
          <PenaltyShootoutPanel
            meetupId={sid}
            match={penaltyMatch}
            onFinished={() => {
              setPenaltyMatch(null);
              void loadMatches();
            }}
          />
        ) : isPastDeadline ? (
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
              isAdmin && editingMatch
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
            goalsLocked={editingMatch?.penalty_winner != null}
            onAddGoal={
              editingMatch && editingMatch.penalty_winner == null
                ? () => setGoalSheet({ match: editingMatch, goal: null })
                : undefined
            }
            onEditGoal={
              editingMatch && editingMatch.penalty_winner == null
                ? (g) => setGoalSheet({ match: editingMatch, goal: g })
                : undefined
            }
          />
        ) : showStartNewMatch && selectingTeams ? (
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
                    {playingTeams?.map((t, i) => (
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
                    {playingTeams?.map((t, i) => (
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
                disabled={busy !== null || selectedTeamA === selectedTeamB || firstShootoutPending}
                className="flex-1 py-3 bg-ink text-board font-bold hover:bg-white/90 disabled:opacity-40 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                <Play className="h-4 w-4" />
                Start match
              </button>
            </div>
          </div>
        ) : showStartNewMatch ? (
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
              {twoPitch && allComplete &&
                (matches.length === 2 || matches.length === 3) && (
                <button type="button" onClick={() => void handleStartNewMatch(true)}
                  disabled={busy !== null || firstShootoutPending}
                  className="inline-flex items-center gap-2 px-8 py-4 bg-ink text-board font-bold disabled:opacity-50">
                  <Play className="h-5 w-5" />
                  {matches.length === 2 ? "Set up final" : "Set up third-place match"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectingTeams(true)}
                disabled={busy !== null || firstShootoutPending}
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
        ) : !currentMatch && canPrepareSelectedPitch ? (
          <div className="py-8 text-center">
            <button type="button" disabled={busy !== null}
              className="min-h-12 bg-live px-6 py-3 font-bold text-board disabled:opacity-50"
              onClick={() => void handleStartAll()}>
              Create match
            </button>
          </div>
        ) : !currentMatch && matches.length > 0 ? (
          <p className="text-sm text-ink-dim">Waiting for the other match to finish.</p>
        ) : !currentMatch ? (
          /* No match started yet */
          <div className="text-center space-y-6 py-12">
            <Flag className="h-16 w-16 mx-auto text-ink-faint" />
            <h2 className="text-xl font-bold text-ink">Ready to start?</h2>
            {playingTeams && playingTeams.length > 2 ? (
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
                        {playingTeams.map((t, i) => (
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
                        {playingTeams.map((t, i) => (
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
            <h2 className="referee-wide-only hidden text-base font-bold text-ink">Match activity</h2>
            {goals.length === 0 && misses.length === 0 && (
              <p className="referee-wide-only hidden border-b border-line pb-4 text-sm text-ink-dim">No goals logged yet.</p>
            )}
            {goals.length > 0 && (
              <div className="border border-line bg-panel px-4 py-2">
                <GoalList
                  goals={goals}
                  canEdit={canControl}
                  onEdit={(g) => setGoalSheet({ match: currentMatch, goal: g })}
                />
              </div>
            )}

            {misses.length > 0 && (
              <section className="border border-line bg-panel px-4 py-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-dim">Penalty misses</h3>
                <ul className="mt-2 space-y-1">
                  {misses.map((miss) => <li key={miss.id} className="text-sm text-ink-dim"><span className="mr-2 tabular-nums">{miss.clock_minute}′</span>{miss.scorer.display_name}</li>)}
                </ul>
              </section>
            )}

            {/* Substitutions — admin only: pre-start, or mid-match while the
                timer is paused. Opens the fullscreen sheet. */}
            {(currentMatch.status === "pending" ||
              (currentMatch.status === "active" && isPaused)) &&
            isAdmin && (
              <button
                type="button"
                onClick={() => setShowSubstitutions(true)}
                className="w-full py-3 border border-line text-ink-dim font-semibold hover:bg-raised hover:text-ink active:scale-[0.98] transition-transform flex items-center justify-center gap-2 min-h-[48px]"
                aria-haspopup="dialog"
              >
                <ArrowRightLeft className="h-4 w-4" aria-hidden />
                Substitutions
              </button>
            )}

            {/* Half-time flash — scrolls with the content; the timer below
                is pinned above the action deck. */}
            {halfTimeFlash && (
              <div className="text-center py-2 px-4 bg-live text-board text-lg font-bold animate-pulse">
                ⚡ Half-time!
              </div>
            )}

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

        </div>

        {/* Past matches */}
        {showCompleted && completedMatches.length > 0 && (
          <div className="mt-6 space-y-3 desktop:mt-0">
            <h3 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
              Completed matches
            </h3>
            {completedMatches.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between border border-line bg-panel px-4 py-3 gap-2"
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
                    className="p-1.5 hover:bg-raised shrink-0 tablet:grid tablet:min-h-11 tablet:min-w-11 tablet:place-items-center"
                    aria-label={`Edit match ${m.match_number}`}
                  >
                    <Edit className="h-4 w-4 text-ink-faint hover:text-ink" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      {liveControls && (
        <div className="referee-console contents">
          <div className="referee-clock shrink-0 border-t border-line bg-board px-4 pt-1 pb-2">
            <h2 className="referee-wide-only hidden text-center text-sm font-medium text-ink-dim">Match clock</h2>
            <div className="mx-auto max-w-lg text-center tablet:max-w-2xl">
              <div className="flex items-center justify-center gap-4">
                {isPaused && currentMatch.status === "active" && (
                  <button type="button" onClick={() => void handleAdjustTimer(-15)}
                    disabled={busy !== null || timerSeconds <= 0}
                    className="min-h-11 min-w-14 border border-line px-3 text-sm font-bold text-ink hover:bg-raised disabled:opacity-50"
                    aria-label="Subtract 15 seconds">−15s</button>
                )}
                <span
                  className={`text-3xl font-bold tabular-nums ${getTimerColor(
                    timerSeconds,
                    currentMatch.timer_total_seconds,
                  )}`}
                >
                  {formatTimer(timerSeconds)}
                </span>
                {isPaused && currentMatch.status === "active" && (
                  <button type="button" onClick={() => void handleAdjustTimer(15)}
                    disabled={busy !== null || timerSeconds >= 600}
                    className="min-h-11 min-w-14 border border-line px-3 text-sm font-bold text-ink hover:bg-raised disabled:opacity-50"
                    aria-label="Add 15 seconds">+15s</button>
                )}
              </div>
              {isPaused && currentMatch.status === "active" && (
                <p className="text-xs font-medium text-ink-dim">Paused</p>
              )}
            </div>
          </div>

          <div className="referee-actions shrink-0 bg-board px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-lg space-y-2 tablet:max-w-2xl">
              {kickoffBlocked && currentMatch.status === "pending" && (
                <p className="text-sm text-ink-dim">Finish or skip the shootout before starting the next match.</p>
              )}
              <div className="referee-primary-actions grid grid-cols-2 gap-2">
                {currentMatch.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => void handleStartTimer()}
                    disabled={busy !== null || kickoffBlocked}
                    className="flex min-h-[56px] items-center justify-center gap-2 bg-live py-4 text-lg font-bold text-board hover:bg-live/90 disabled:opacity-50 active:scale-[0.98] transition-transform"
                  >
                    <Play className="h-5 w-5" />
                    Start Timer
                  </button>
                )}
                {currentMatch.status === "active" && !isPaused && (
                  <button
                    type="button"
                    onClick={() => void handlePauseTimer()}
                    disabled={busy !== null}
                    className="flex min-h-[56px] items-center justify-center gap-2 bg-live py-4 text-lg font-bold text-board hover:bg-live/90 disabled:opacity-50 active:scale-[0.98] transition-transform"
                  >
                    <Pause className="h-5 w-5" />
                    Pause
                  </button>
                )}
                {currentMatch.status === "active" && isPaused && (
                  <button
                    type="button"
                    onClick={() => void handleResumeTimer()}
                    disabled={busy !== null}
                    className="flex min-h-[56px] items-center justify-center gap-2 bg-live py-4 text-lg font-bold text-board hover:bg-live/90 disabled:opacity-50 active:scale-[0.98] transition-transform"
                  >
                    <Play className="h-5 w-5" />
                    Resume
                  </button>
                )}
                {currentMatch.status !== "time_up" && (
                  <button
                    type="button"
                    disabled={(!!lease && leaseLeft > 0) || busy !== null}
                    onClick={() => setGoalSheet({ match: currentMatch, goal: null })}
                    className="flex min-h-[56px] items-center justify-center gap-2 bg-ink py-4 text-lg font-bold text-board hover:bg-white/90 disabled:opacity-60 active:scale-[0.98] transition-transform"
                  >
                    {lease && leaseLeft > 0 && !showSubstitutions
                      ? leaseBusyButtonLabel(lease.holderName, leaseLeft)
                      : "+ Goal"}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmAction({ kind: "end" })}
                  disabled={busy !== null}
                  className="flex min-h-[48px] flex-1 items-center justify-center gap-2 border-2 border-ink/30 py-3 text-base font-bold text-ink hover:bg-raised disabled:opacity-50 active:scale-[0.98] transition-transform"
                >
                  <Flag className="h-5 w-5" />
                  End Match
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
            goalSheet.goal ? handleGoalDeleted : undefined
          }
        />
      )}

      {/* Substitutions — fullscreen sheet, admin only */}
      {showSubstitutions && currentMatch && (
        <MobileSheet
          title="Substitutions"
          onClose={() => setShowSubstitutions(false)}
        >
          <SubstitutionsPanel
            key={currentMatch.id}
            meetupId={sid}
            match={currentMatch}
            extraTeams={extraTeams}
            onSaved={loadMatches}
          />
        </MobileSheet>
      )}

      {/* Mid-meetup team reshape — admin only, from the header gear */}
      {isAdmin && showReshape && meetupDetail && teamsData && (
        <TeamReshapeSheet
          key={sid}
          meetupId={sid}
          totalPlayers={reshapeTotalPlayers}
          waitlistedPlayers={meetupDetail.attendees.filter((a) => a.status === "waitlisted").length}
          teams={teamsData}
          maxTeams={meetupDetail.max_teams}
          currentTeamSize={meetupDetail.team_size}
          minPlayers={meetupDetail.min_players}
          maxPlayers={meetupDetail.max_players}
          startTime={meetupDetail.start_time}
          hasStarted={Boolean(meetupDetail.has_started) || matches.some((m) => m.status !== "pending")}
          liveMatchNumber={
            matches.find((m) => m.status === "active" || m.status === "time_up")?.match_number ?? null
          }
          onResetMatch={
            currentMatch
              ? () => {
                  setShowReshape(false);
                  setConfirmAction({ kind: "reset" });
                }
              : undefined
          }
          onDeleteMatch={
            currentMatch
              ? () => {
                  setShowReshape(false);
                  setConfirmAction({ kind: "delete", matchId: currentMatch.id });
                }
              : undefined
          }
          onClose={() => setShowReshape(false)}
          onSaved={(result, teamCount, signupCapacity, teamSize) => {
            setTeamsData(result.teams);
            setSelectedTeamA(0);
            setSelectedTeamB(1);
            setMeetupDetail((detail) => detail && { ...detail, max_teams: teamCount, max_players: signupCapacity, team_size: teamSize });
            void fetchMeetupDetail(sid).then(setMeetupDetail).catch(() => {});
            void loadMatches();
          }}
        />
      )}
    </div>
  );
}
