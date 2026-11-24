import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "../context/ToastContext";
import {
  acquireLease,
  createGoal,
  releaseLease,
  renewLease,
  updateGoal,
  type GoalRow,
} from "../api/stewardApi";
import type { MatchSummary } from "../api/matchesApi";
import {
  leaseBusyLabel,
  leaseCountdown,
  leaseFromExpiresIn,
  type LeaseInfo,
} from "../utils/lease";
import {
  GoalEntryFlow,
  type GoalSubmitInput,
} from "./GoalEntryFlow";

interface GoalEntrySheetProps {
  meetupId: number;
  match: MatchSummary;
  onClose: () => void;
  onLogged: (goal: GoalRow) => void;
  /** Present → edit mode: the sheet prefills from this goal and PATCHes it. */
  editGoal?: GoalRow | null;
  /** Only offered in edit mode — removes the goal row (light two-tap confirm). */
  onDeleteGoal?: (goal: GoalRow) => void;
}

export function GoalEntrySheet({
  meetupId,
  match,
  onClose,
  onLogged,
  editGoal = null,
  onDeleteGoal,
}: GoalEntrySheetProps) {
  const { showToast } = useToast();

  // ── Lease state ──────────────────────────────────────────────────
  const [lease, setLease] = useState<LeaseInfo | null>(null); // someone else
  const [holding, setHolding] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const tryAcquire = useCallback(async (): Promise<boolean> => {
    setAcquiring(true);
    try {
      const res = await acquireLease(meetupId, match.id);
      if (res.ok) {
        tokenRef.current = res.lease.lease_token;
        setHolding(true);
        setLease(null);
        return true;
      }
      setHolding(false);
      setLease(
        leaseFromExpiresIn(res.busy.holder_name, res.busy.expires_in),
      );
      return false;
    } catch (e) {
      setHolding(false);
      showToast(
        e instanceof Error ? e.message : "Could not reach the server",
        "error",
      );
      return false;
    } finally {
      setAcquiring(false);
    }
  }, [meetupId, match.id, showToast]);

  // Acquire immediately on open; keep renewed while open; release on unmount.
  useEffect(() => {
    void tryAcquire();
    const renewTimer = setInterval(() => {
      if (!tokenRef.current) return;
      void (async () => {
        const res = await renewLease(meetupId, tokenRef.current!, match.id);
        if (res.ok) {
          setLease(null);
          setHolding(true);
        } else {
          setHolding(false);
          setLease(
            leaseFromExpiresIn(res.busy.holder_name, res.busy.expires_in),
          );
        }
      })();
    }, 20_000);
    return () => {
      clearInterval(renewTimer);
      if (tokenRef.current) void releaseLease(meetupId, tokenRef.current, match.id);
      tokenRef.current = null;
    };
  }, [meetupId, match.id, tryAcquire]);

  const isEdit = !!editGoal;

  const submitGoal = useCallback(
    async (input: GoalSubmitInput) => {
      if (!holding) {
        const won = await tryAcquire();
        if (!won) throw new Error("busy");
      }
      const res = isEdit && editGoal
        ? await updateGoal(meetupId, match.id, editGoal.id, {
            team: input.team,
            scorer_id: input.scorer_id,
            assist_id: input.assist_id,
            goalkeeper_id: input.goalkeeper_id,
            clock_minute: input.minute,
            is_own_goal: input.is_own_goal,
          })
        : await createGoal(meetupId, match.id, {
            team: input.team,
            scorer_id: input.scorer_id,
            assist_id: input.assist_id,
            goalkeeper_id: input.goalkeeper_id,
            clock_minute: input.minute,
            intent_id: input.intent_id,
            force: input.force,
            is_own_goal: input.is_own_goal,
          });
      if (!res.goal) throw new Error("Goal could not be saved.");
      onLogged(res.goal);
      return res.goal;
    },
    [editGoal, holding, isEdit, match.id, meetupId, onLogged, tryAcquire],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edit goal" : "Log a goal"}
    >
      <div className="w-full max-w-md bg-panel border border-line shadow-xl flex flex-col max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh]">
        {/* Header + lease status — pinned; only the content below scrolls */}
        <div className="flex items-center justify-between shrink-0 p-4 pb-2">
          <h3 className="shrink-0 text-lg font-bold text-ink">
            {isEdit ? "Edit goal" : "Log a goal"}
          </h3>
          <div className="flex min-w-0 items-center justify-end gap-2">
            {holding ? (
              <span className="text-xs font-semibold text-team-a tabular-nums">
                Your turn
              </span>
            ) : lease ? (
              <span className="text-right text-xs font-semibold text-live tabular-nums">
                {leaseBusyLabel(lease.holderName, leaseCountdown(lease))}
              </span>
            ) : (
              <span className="text-xs text-ink-faint">No lease</span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-ink-dim hover:bg-raised focus:outline-hidden focus:ring-2 focus:ring-live"
              aria-label="Close goal entry"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-4 pb-4">
          <GoalEntryFlow
            match={match}
            editGoal={editGoal}
            canSubmit={!acquiring && (holding || lease === null)}
            onSubmit={submitGoal}
            onClose={onClose}
            onDeleteGoal={onDeleteGoal}
          />
        </div>
      </div>
    </div>
  );
}
