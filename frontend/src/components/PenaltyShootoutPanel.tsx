import { useCallback, useEffect, useRef, useState } from "react";
import {
  addPenaltyShot,
  finishPenaltyShootout,
  fetchPenalty,
  undoPenaltyShot,
  skipPenaltyShootout,
  type MatchSummary,
  type PenaltyState,
} from "../api/matchesApi";
import { useToast } from "../context/ToastContext";
import { Check, Loader2, RotateCcw, X } from "lucide-react";

/**
 * Quick penalty-shootout logger for a tied first match. Shows up
 * automatically in the referee view; taps are logged in turn (teams
 * alternate, team A first) with the taker picked per shot — the order
 * is decided on the pitch.
 */
export function PenaltyShootoutPanel({
  meetupId,
  match,
  onFinished,
}: {
  meetupId: number;
  match: MatchSummary;
  onFinished: () => void;
}) {
  const { showToast } = useToast();
  const [state, setState] = useState<PenaltyState | null>(null);
  const [scorerId, setScorerId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const doneRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const s = await fetchPenalty(meetupId, match.id);
      setState((previous) => previous?.winner && !s.winner ? previous : s);
      // Default the taker picker to the first roster player of the team
      // on turn — one less tap in the rain.
      const counts = s.counts;
      const onTurn = counts.a === counts.b ? "a" : "b";
      const roster = (onTurn === "a" ? match.team_a : match.team_b).users;
      if (roster.length && !roster.some((u) => u.id === scorerId)) {
        setScorerId(roster[0].id);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not load the shootout", "error");
    }
    // scorerId is intentionally not a dependency — we only re-default it
    // when the current picker is not on the team on turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetupId, match, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state?.winner) doneRef.current?.focus();
  }, [state?.winner]);

  if (!state) {
    return (
      <section className="border border-line bg-panel p-4">
        <Loader2 className="h-5 w-5 animate-spin text-live" aria-hidden />
      </section>
    );
  }

  const nextTeam: "a" | "b" =
    state.counts.a === state.counts.b ? "a" : "b";
  const roster = (nextTeam === "a" ? match.team_a : match.team_b).users;
  const teamName = (t: "a" | "b") =>
    t === "a" ? match.team_a.name : match.team_b.name;

  const shoot = async (scored: boolean) => {
    if (busy || state.winner || scorerId == null) return;
    setBusy(true);
    try {
      const next = await addPenaltyShot(
        meetupId,
        match.id,
        nextTeam,
        scored,
        scorerId,
      );
      setState(next);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Shot not recorded", "error");
      void load();
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (busy || state.winner) return;
    setBusy(true);
    try {
      setState(await undoPenaltyShot(meetupId, match.id));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Undo failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (busy || !state.decided) return;
    setBusy(true);
    try {
      const res = await finishPenaltyShootout(meetupId, match.id);
      showToast(`${teamName(res.winner)} wins the shootout`, "success");
      // Keep the result on screen — the winner line and shots stay visible
      // until the user taps Done (which closes the panel).
      setState((s) => (s ? { ...s, winner: res.winner } : s));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not finish", "error");
      void load();
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await skipPenaltyShootout(meetupId, match.id);
      showToast("Shootout skipped", "success");
      onFinished();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not skip shootout", "error");
      void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-line bg-panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
          Penalty shootout
        </h3>
        <span className="text-lg font-bold tabular-nums">
          {state.shots.filter((shot) => shot.team === "a" && shot.scored).length} – {state.shots.filter((shot) => shot.team === "b" && shot.scored).length}
        </span>
      </div>

      {/* Scored / missed per side, in shot order */}
      {state.shots.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {(["a", "b"] as const).map((t) => (
            <div key={t} className="space-y-1">
              <p
                className={`text-2xs font-bold uppercase tracking-wide truncate ${
                  t === "a" ? "text-team-a" : "text-team-b"
                }`}
              >
                {teamName(t)}
              </p>
              <div className="flex flex-wrap gap-1">
                {state.shots
                  .filter((s) => s.team === t)
                  .map((s) => (
                    <span
                      key={s.id}
                      title={s.scorer.display_name}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        s.scored
                          ? "bg-live text-board"
                          : "bg-raised text-ink-dim"
                      }`}
                    >
                      {s.scored ? (
                        <Check className="h-3.5 w-3.5" aria-label="scored" />
                      ) : (
                        <X className="h-3.5 w-3.5" aria-label="missed" />
                      )}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {state.winner ? (
        <div className="space-y-2">
          <p className="border border-live/40 bg-live/10 px-3 py-2 text-sm font-bold text-live">
            {teamName(state.winner)} wins the shootout
          </p>
          <button
            ref={doneRef}
            type="button"
            onClick={() => onFinished()}
            className="min-h-[44px] w-full bg-ink text-board px-3 py-2 text-sm font-bold hover:bg-white/90 active:scale-[0.98] transition-transform"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <label
              htmlFor="penalty-scorer"
              className="block text-xs font-semibold text-ink-dim"
            >
              {teamName(nextTeam)} shoots — who takes it?
            </label>
            <select
              id="penalty-scorer"
              value={scorerId ?? undefined}
              onChange={(e) => setScorerId(Number(e.target.value))}
              disabled={busy}
              className="w-full min-h-[44px] border border-line bg-raised px-3 py-2 text-sm text-ink"
            >
              {roster.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => void shoot(true)}
              disabled={busy || scorerId == null}
              className="min-h-[56px] bg-live text-board text-lg font-bold hover:bg-live/90 disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
            >
              <Check className="h-5 w-5" aria-hidden /> Score
            </button>
            <button
              type="button"
              onClick={() => void shoot(false)}
              disabled={busy || scorerId == null}
              className="min-h-[56px] border-2 border-ink/30 text-ink text-lg font-bold hover:bg-raised disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
            >
              <X className="h-5 w-5" aria-hidden /> Miss
            </button>
          </div>

          <button
            type="button"
            onClick={() => void skip()}
            disabled={busy}
            className="min-h-[44px] border border-line px-3 py-2 text-sm font-semibold text-ink-dim hover:text-ink disabled:opacity-40"
          >
            Skip shootout
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void undo()}
              disabled={busy || state.shots.length === 0}
              className="min-h-[44px] flex items-center gap-1.5 border border-line px-3 py-2 text-sm font-semibold text-ink-dim hover:text-ink disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" aria-hidden /> Undo
            </button>
            {state.decided && (
              <button
                type="button"
                onClick={() => void finish()}
                disabled={busy}
                className="min-h-[44px] flex-1 items-center justify-center gap-1.5 bg-ink text-board px-3 py-2 text-sm font-bold hover:bg-white/90 disabled:opacity-50"
              >
                Confirm winner
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
