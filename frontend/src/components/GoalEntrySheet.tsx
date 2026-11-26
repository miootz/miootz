import { useCallback, useEffect, useRef, useState } from "react";
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
import { MobileSheet } from "./MobileSheet";
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
  onDeleteGoal?: (goal: GoalRow) => Promise<void>;
}

export function GoalEntrySheet({
  meetupId,
  match,
  onClose,
  onLogged,
  editGoal = null,
  onDeleteGoal,
}: GoalEntrySheetProps) {
  // ── Lease state ──────────────────────────────────────────────────
  const [lease, setLease] = useState<LeaseInfo | null>(null); // someone else
  const [holding, setHolding] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [leaseError, setLeaseError] = useState("");
  const tokenRef = useRef<string | null>(null);

  const tryAcquire = useCallback(async (): Promise<boolean> => {
    setAcquiring(true);
    setLeaseError("");
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
      setLeaseError(e instanceof Error ? e.message : "Could not reach the server.");
      return false;
    } finally {
      setAcquiring(false);
    }
  }, [meetupId, match.id]);

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

  const leaseChip = holding ? (
    <span className="text-xs font-semibold text-team-a tabular-nums">
      Your turn
    </span>
  ) : lease ? (
    <span className="max-w-40 truncate text-right text-xs font-semibold text-live tabular-nums">
      {leaseBusyLabel(lease.holderName, leaseCountdown(lease))}
    </span>
  ) : (
    <span className="text-xs text-ink-faint">No lease</span>
  );

  return (
    <MobileSheet
      onClose={onClose}
      title={isEdit ? "Edit goal" : "Log a goal"}
      headerExtra={leaseChip}
      bodyClassName="overflow-hidden px-0 py-0"
    >
      <p role="status" className={leaseError ? "px-4 py-2 text-sm text-danger" : "sr-only"}>{leaseError}</p>
      <GoalEntryFlow
        match={match}
        editGoal={editGoal}
        canSubmit={!acquiring && (holding || lease === null)}
        onSubmit={submitGoal}
        onClose={onClose}
        onDeleteGoal={onDeleteGoal}
      />
    </MobileSheet>
  );
}
