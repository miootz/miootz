import { parseMeetupStart } from "../utils/datetime";
import { useContext, useEffect, useMemo, useState } from "react";
import {
  deleteMatch,
  fetchMatchSubstitutions,
  fetchMeetupMatches,
  type MatchSummary,
  type MatchSubstitution,
} from "../api/matchesApi";
import { ChevronDown, Loader2, Pencil, Plus, Trash2, Trophy } from "lucide-react";
import type { MeetupDetail } from "../api/meetupsApi";
import { AuthContext } from "../auth/auth-context";
import { useToast } from "../context/ToastContext";
import { deletePenaltyMiss, fetchGoals, fetchPenaltyMisses, type GoalRow, type PenaltyMissRow } from "../api/stewardApi";
import { subscribeMeetupData } from "../utils/meetupDataBus";
import { GoalList } from "./GoalList";
import { PlayerEditLink } from "./PlayerEditLink";
import { MatchDialog } from "./MatchDialog";

interface MatchHistoryListProps {
  meetupId: number;
  /** When true, admins can edit scores and match details. */
  editable?: boolean;
  allowCreate?: boolean;
  refreshKey?: number;
  attendees?: MeetupDetail["attendees"];
}

export function MatchHistoryList(props: MatchHistoryListProps) {
  return <MatchHistoryContent key={props.meetupId} {...props} />;
}

function MatchHistoryContent({
  meetupId,
  editable = false,
  allowCreate = true,
  refreshKey,
  attendees,
}: MatchHistoryListProps) {
  const { showToast } = useToast();
  const auth = useContext(AuthContext);
  const isAdmin = auth?.me?.is_admin ?? false;
  const canEdit = editable && isAdmin;

  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveRevision, setLiveRevision] = useState(0);
  const [rowRevision, setRowRevision] = useState(0);
  const [dialog, setDialog] = useState<
    { mode: "add" } | { mode: "edit"; matchId: number } | null
  >(null);
  const editingMatch = dialog?.mode === "edit"
    ? matches.find((match) => match.id === dialog.matchId)
    : undefined;

  useEffect(() => {
    let current = true;
    void fetchMeetupMatches(meetupId).then(({ matches }) => {
      if (current) setMatches(matches.filter((match) => match.status === "completed"));
    }).catch(() => {
      // Keep the last successful list if a live refresh fails.
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [meetupId, refreshKey, liveRevision]);

  useEffect(() => {
    if (!auth?.tokens?.accessToken) return;
    return subscribeMeetupData(meetupId, auth.tokens.accessToken, (event) => {
      if (["goal_added", "goal_updated", "goal_removed", "penalty_missed", "penalty_miss_removed", "match_ended", "match_penalty_finished"].includes(String(event.type))) {
        setLiveRevision((revision) => revision + 1);
      }
    });
  }, [meetupId, auth?.tokens?.accessToken]);

  const handleCreated = (match: MatchSummary) => {
    setMatches((prev) => [...prev, match]);
    setDialog({ mode: "edit", matchId: match.id });
    showToast("Match created.", "success");
  };

  const handleDeleteMatch = async (matchId: number) => {
    await deleteMatch(meetupId, matchId);
    setMatches((prev) => prev.filter((m) => m.id !== matchId));
    setDialog(null);
    showToast("Match deleted", "success");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-sm text-ink-dim">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading matches…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Add match button */}
      {canEdit && allowCreate && (
        <button
          type="button"
          onClick={() => setDialog({ mode: "add" })}
          className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 border border-dashed border-line text-ink-dim text-sm font-medium hover:bg-raised hover:text-ink active:scale-[0.99] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add match result
        </button>
      )}

      {matches.length === 0 ? (
        <div className="border border-dashed border-line p-6 text-center">
          <Trophy className="w-6 h-6 mx-auto text-ink-faint mb-1.5" />
          <p className="text-sm text-ink-dim">No match results recorded yet.</p>
        </div>
      ) : (
        <>
      <div className="space-y-2">
        {matches.map((m) => (
          <MatchResultRow
            key={m.id}
            meetupId={meetupId}
            match={m}
            liveRevision={liveRevision + rowRevision}
            refreshKey={refreshKey}
            canEdit={canEdit}
            attendees={attendees}
            onEdit={() => setDialog({ mode: "edit", matchId: m.id })}
          />
        ))}
      </div>
        </>
      )}

      {dialog && (dialog.mode === "add" || editingMatch) && (
        <MatchDialog
          meetupId={meetupId}
          attendees={attendees}
          existingMatches={matches}
          mode={dialog.mode}
          match={editingMatch ?? null}
          onClose={() => setDialog(null)}
          onCreated={handleCreated}
          onSaved={(matchId, updated) => {
            setMatches((previous) =>
              previous.map((row) => (row.id === matchId ? { ...row, ...updated } : row)),
            );
            setRowRevision((revision) => revision + 1);
          }}
          onDelete={handleDeleteMatch}
        />
      )}
    </div>
  );
}

// ── Single match row ───────────────────────────────────────────────

function MatchResultRow({
  meetupId,
  match,
  canEdit,
  attendees,
  liveRevision,
  refreshKey,
  onEdit,
}: {
  meetupId: number;
  match: MatchSummary;
  canEdit: boolean;
  attendees?: MeetupDetail["attendees"];
  liveRevision: number;
  refreshKey?: number;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // null = not fetched yet; lazy-load on first expand
  const [subs, setSubs] = useState<MatchSubstitution[] | null>(null);
  const [goals, setGoals] = useState<GoalRow[] | null>(null);
  const [misses, setMisses] = useState<PenaltyMissRow[] | null>(null);
  const [missLoadError, setMissLoadError] = useState(false);
  const { showToast } = useToast();
  const [subLoadError, setSubLoadError] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let current = true;
    fetchMatchSubstitutions(meetupId, match.id).then((r) => {
      if (!current) return;
      setSubs(r.substitutions);
      setSubLoadError(false);
    }).catch(() => {
      if (current) setSubLoadError(true);
    });
    fetchGoals(meetupId, match.id)
      .then((result) => { if (current) setGoals(result); })
      .catch(() => { if (current) setGoals([]); });
    fetchPenaltyMisses(meetupId, match.id)
      .then((result) => { if (current) { setMisses(result); setMissLoadError(false); } })
      .catch(() => { if (current) setMissLoadError(true); });
    return () => { current = false; };
  }, [expanded, meetupId, match.id, liveRevision, refreshKey]);

  const handleDeleteMiss = async (miss: PenaltyMissRow) => {
    try {
      await deletePenaltyMiss(meetupId, match.id, miss.id);
      setMisses((rows) => (rows ?? []).filter((row) => row.id !== miss.id));
      showToast("Penalty miss removed", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not delete penalty miss", "error");
    }
  };

  const nameById = useMemo(() => {
    const m = new Map(attendees?.map((attendee) => [attendee.user_id, attendee.display_name]));
    for (const u of match.team_a.users) m.set(u.id, u.display_name);
    for (const u of match.team_b.users) m.set(u.id, u.display_name);
    return m;
  }, [match, attendees]);

  const movesFor = (s: MatchSubstitution): string[] => {
    const oldA = new Set(s.old_team_a_users);
    const oldB = new Set(s.old_team_b_users);
    const out: string[] = [];
    for (const id of s.new_team_b_users)
      if (!oldB.has(id))
        out.push(`${nameById.get(id) ?? "?"} → ${match.team_b.name}`);
    for (const id of s.new_team_a_users)
      if (!oldA.has(id))
        out.push(`${nameById.get(id) ?? "?"} → ${match.team_a.name}`);
    const onPitch = new Set([...s.new_team_a_users, ...s.new_team_b_users]);
    for (const id of [...oldA, ...oldB])
      if (!onPitch.has(id))
        out.push(`${nameById.get(id) ?? "?"} → Bench`);
    return out;
  };

  const winner =
    match.score_a > match.score_b ? "a" : match.score_b > match.score_a ? "b" : null;

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
      {/* Match header — tap to expand rosters + substitutions */}
      <div className="flex items-center bg-board border-b border-line">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-2 px-4 py-2.5 text-left min-h-[44px]"
          aria-expanded={expanded}
        >
          <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim tabular-nums">
            Match {match.match_number}
          </span>
          {match.was_draw && (
            <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-faint border border-line px-1.5 py-0.5">
              Draw
            </span>
          )}
          {timeLabel && (
            <>
              <span className="text-ink-faint">·</span>
              <span className="text-2xs text-ink-dim tabular-nums">{timeLabel}</span>
            </>
          )}
          <span className="ml-auto">
            <ChevronDown
              className={`h-4 w-4 text-ink-faint transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
              aria-hidden
            />
          </span>
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="grid h-11 w-11 shrink-0 place-items-center border-l border-line text-ink-dim hover:bg-raised hover:text-ink"
            aria-label={`Edit match ${match.match_number}`}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="px-4 py-3 flex flex-col gap-2">
        {/* Score — read-only */}
        <div className="flex items-center justify-center gap-2">
          <span className="text-3xl font-bold tabular-nums text-ink min-w-[2ch] text-center">
            {match.score_a}
          </span>
          <span className="text-ink-faint text-xl font-bold select-none">:</span>
          <span className="text-3xl font-bold tabular-nums text-ink min-w-[2ch] text-center">
            {match.score_b}
          </span>
        </div>

        {/* Team names — 50/50 so full names fit */}
        <div className="flex items-center">
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold truncate block text-team-a">
              {match.team_a.name}
            </span>
          </div>
          <div className="flex-1 min-w-0 text-right">
            <span className="text-sm font-semibold truncate block text-team-b">
              {match.team_b.name}
            </span>
          </div>
        </div>

        {/* Expanded: scorers, final rosters + substitution log */}
        {expanded && (
          <div className="border-t border-line pt-3 space-y-3">
            {match.penalty_winner && (
              <p className="text-xs text-ink-dim tabular-nums">
                Shootout: {match.penalty_score_a != null && match.penalty_score_b != null && <>{match.penalty_score_a} – {match.penalty_score_b} — </>}
                {match.penalty_winner === "a" ? match.team_a.name : match.team_b.name} wins
              </p>
            )}
            {goals && goals.length > 0 && (
              <div className="bg-raised px-3 py-1">
                <GoalList
                  goals={goals}
                  canEdit={false}
                  onEdit={() => {}}
                  emptyLabel=""
                />
              </div>
            )}
            {missLoadError && <p role="alert" className="text-sm text-danger">Couldn’t load penalty misses.</p>}
            {misses && misses.length > 0 && (
              <div className="space-y-1">
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">Penalty misses</p>
                <ul className="divide-y divide-line">
                  {misses.map((miss) => (
                    <li key={miss.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-sm text-ink-dim"><span className="mr-2 tabular-nums text-ink-faint">{miss.clock_minute}′</span>{miss.scorer.display_name} (miss)</span>
                      {canEdit && <button type="button" onClick={() => void handleDeleteMiss(miss)}
                        className="grid h-11 w-11 place-items-center text-ink-faint hover:text-danger"
                        aria-label={`Delete penalty miss by ${miss.scorer.display_name}`}><Trash2 className="h-4 w-4" aria-hidden /></button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  [match.team_a, "text-team-a"],
                  [match.team_b, "text-team-b"],
                ] as const
              ).map(([team, color]) => (
                <div key={team.name} className="min-w-0">
                  <p
                    className={`text-xs font-bold uppercase tracking-wide truncate ${color}`}
                  >
                    {team.name}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {team.users.map((u) => (
                      <li
                        key={u.id}
                        className="relative text-sm text-ink-dim truncate"
                      >
                        <PlayerEditLink playerId={u.id} stretch>{u.display_name}</PlayerEditLink>
                        {(u.pac ?? 3) > 3 && <span className="ml-1 text-2xs font-bold text-attribute-pac">PAC</span>}
                        {(u.dri ?? 3) > 3 && <span className="ml-1 text-2xs font-bold text-attribute-dri">DRI</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {subLoadError && (
              <p className="text-sm text-danger" role="alert">
                Couldn’t load substitutions.{" "}
                <button type="button" onClick={() => setSubLoadError(false)} className="min-h-12 underline">Retry</button>
              </p>
            )}
            {subs && subs.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                  Substitutions
                </p>
                {[...subs].sort((a, b) => (a.clock_secs ?? -1) - (b.clock_secs ?? -1)).map((s) => (
                  <div key={s.id} className="flex gap-2 text-xs">
                    <span className="tabular-nums text-ink-faint shrink-0">
                      {s.clock_secs == null
                        ? "Before kickoff"
                        : `${Math.floor(s.clock_secs / 60)}:${String(s.clock_secs % 60).padStart(2, "0")}`}
                    </span>
                    <span className="text-ink-dim">
                      {movesFor(s).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
