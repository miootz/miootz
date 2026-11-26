import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteGoal,
  fetchGoals,
  fetchPenaltyMisses,
  fetchStewardState,
  type GoalRow,
  type PenaltyMissRow,
  type StewardState,
} from "../api/stewardApi";
import {
  leaseCountdown,
  leaseFromExpiresIn,
  type LeaseInfo,
} from "../utils/lease";

/**
 * Shared state for the live-scoring surfaces (LiveMatchBanner and
 * RefereePage), fed from the ONE existing meetup data SSE channel:
 *
 * - steward gate: fetched on mount and every 30 s — decides whether
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
  const [misses, setMisses] = useState<PenaltyMissRow[]>([]);
  const snapshotRequest = useRef(0);

  // Steward gate — fetched on mount and every 30 s: the control window opens
  // around kickoff, so a member already on the live page must see the
  // controls appear without navigating away.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
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
    };
    void load();
    const iv = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [sid]);

  // Goal snapshot for the current match: (re)fetch when the match changes.
  const refreshGoals = useCallback(async () => {
    const request = ++snapshotRequest.current;
    if (matchId == null) {
      setGoals([]);
      setMisses([]);
      return;
    }
    const [goalsResult, missesResult] = await Promise.allSettled([
      fetchGoals(sid, matchId),
      fetchPenaltyMisses(sid, matchId),
    ]);
    if (request !== snapshotRequest.current) return;
    if (goalsResult.status === "fulfilled") setGoals(goalsResult.value);
    if (missesResult.status === "fulfilled") setMisses(missesResult.value);
  }, [sid, matchId]);

  useEffect(() => {
    void refreshGoals();
    return () => { snapshotRequest.current += 1; };
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
      if (typeof data.match_id === "number" && data.match_id !== matchId) return false;
      switch (data.type) {
        case "goal_added":
        case "goal_removed":
        case "goal_updated":
        case "penalty_missed":
        case "penalty_miss_removed":
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
    [matchId, refreshGoals],
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

  return { steward, lease, leaseLeft, goals, misses, applyEvent, removeGoal, refreshGoals };
}
