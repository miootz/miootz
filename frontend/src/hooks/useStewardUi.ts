import { useCallback, useEffect, useState } from "react";
import {
  deleteGoal,
  fetchGoals,
  fetchStewardState,
  type GoalRow,
  type StewardState,
} from "../api/stewardApi";
import {
  leaseCountdown,
  leaseFromExpiresIn,
  type LeaseInfo,
} from "../utils/lease";

/**
 * Shared state for the live-scoring surfaces (LiveMatchBanner and
 * RefereePage), fed from the ONE existing session data SSE channel:
 *
 * - steward gate: fetched once on mount per session — decides whether
 *   controls render and what reason line a locked member sees.
 * - lease chip: seeded from the steward snapshot, then kept in sync from
 *   `lease_acquired` / `lease_released` events. The countdown is always
 *   re-derived from the local wall clock each tick (never from a cached
 *   "remaining"), and self-clears when it expires — an expired lease
 *   does not broadcast a release event.
 * - goal log: snapshot for the current match. `goal_added` /
 *   `goal_removed` trigger a snapshot refetch (never an event replay),
 *   which self-heals across SSE reconnect gaps and cannot duplicate or
 *   mis-order rows (fetchGoals returns the canonical, id-keyed list).
 */
export function useStewardUi(sid: number, matchId: number | null) {
  const [steward, setSteward] = useState<StewardState | null>(null);
  const [lease, setLease] = useState<LeaseInfo | null>(null);
  const [leaseLeft, setLeaseLeft] = useState(0);
  const [goals, setGoals] = useState<GoalRow[]>([]);

  // Steward gate — fetched once on mount (per session id).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await fetchStewardState(sid);
        if (cancelled) return;
        setSteward(s);
        if (s.lease) {
          setLease(
            leaseFromExpiresIn(s.lease.holder_name, s.lease.expires_in),
          );
        }
      } catch {
        // Stay null → controls stay hidden until the next refresh.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid]);

  // Goal snapshot for the current match: (re)fetch when the match changes.
  const refreshGoals = useCallback(async () => {
    if (matchId == null) {
      setGoals([]);
      return;
    }
    try {
      const rows = await fetchGoals(sid, matchId);
      setGoals(rows);
    } catch {
      // Keep the previous snapshot; the next event/refresh will correct it.
    }
  }, [sid, matchId]);

  useEffect(() => {
    void refreshGoals();
  }, [refreshGoals]);

  // Lease chip: re-derive the countdown from the wall clock each second;
  // clear when it expires (no release event is guaranteed at expiry).
  useEffect(() => {
    if (!lease) {
      setLeaseLeft(0);
      return;
    }
    const tick = () => {
      const left = leaseCountdown(lease); // anchored to Date.now()
      if (left <= 0) {
        setLease(null);
        setLeaseLeft(0);
      } else {
        setLeaseLeft(left);
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [lease]);

  /**
   * Feed one parsed SSE message from the page's existing channel.
   * Returns true when the type belongs to the scoring domain (the page
   * should also refresh its match data for those).
   */
  const applyEvent = useCallback(
    (data: Record<string, unknown>) => {
      switch (data.type) {
        case "goal_added":
        case "goal_removed":
          void refreshGoals();
          return true;
        case "lease_acquired": {
          const holder =
            typeof data.holder_name === "string" && data.holder_name
              ? data.holder_name
              : "Someone";
          const expiresIn =
            typeof data.expires_in === "number" && isFinite(data.expires_in)
              ? data.expires_in
              : 45;
          setLease(leaseFromExpiresIn(holder, expiresIn));
          return true;
        }
        case "lease_released":
          setLease(null);
          setLeaseLeft(0);
          return true;
        default:
          return false;
      }
    },
    [refreshGoals],
  );

  /** Delete a goal row (caller is gated by can_control); refreshes snapshot. */
  const removeGoal = useCallback(
    async (goalId: number) => {
      if (matchId == null) return;
      try {
        await deleteGoal(sid, matchId, goalId);
      } finally {
        void refreshGoals();
      }
    },
    [sid, matchId, refreshGoals],
  );

  return { steward, lease, leaseLeft, goals, applyEvent, removeGoal, refreshGoals };
}
