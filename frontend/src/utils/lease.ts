/**
 * Pure lease / countdown helpers for the one-writer goal-entry lease
 * (plan: live-collaborative-scoring §2.3, §4, §6).
 *
 * All time math is anchored to local wall-clock ms derived from the
 * server's `expires_in` seconds — we never trust a client-computed
 * remaining value across renders, we re-derive it from `now` each tick.
 */

export interface LeaseInfo {
  /** Display name of the current holder (the room sees this, named). */
  holderName: string;
  /** Local wall-clock ms when the lease stops being valid. */
  expiresAt: number;
  /** True when the current viewer holds the lease (drives "You" copy). */
  isMe: boolean;
}

/** Seconds left on the lease, never negative, never fractional. */
export function leaseCountdown(
  lease: LeaseInfo | null,
  now: number = Date.now(),
): number {
  if (!lease) return 0;
  return Math.max(0, Math.ceil((lease.expiresAt - now) / 1000));
}

export function leaseActive(
  lease: LeaseInfo | null,
  now: number = Date.now(),
): boolean {
  return leaseCountdown(lease, now) > 0;
}

/** Build a LeaseInfo from an API `expires_in` seconds response. */
export function leaseFromExpiresIn(
  holderName: string,
  expiresInSec: number,
  isMe = false,
  now: number = Date.now(),
): LeaseInfo {
  return {
    holderName,
    expiresAt: now + Math.max(0, expiresInSec) * 1000,
    isMe,
  };
}

/** Named busy label — never silent (§6: "Carlos is entering a goal… 38s"). */
export function leaseBusyLabel(
  holderName: string,
  countdownSec: number,
): string {
  return `${holderName} is entering a goal… ${Math.max(0, Math.ceil(countdownSec))}s`;
}

/** Compact busy label for the + Goal button — stays on one line. */
export function leaseBusyButtonLabel(
  holderName: string,
  countdownSec: number,
): string {
  const first = holderName.trim().split(/\s+/)[0] || holderName;
  return `${first} · ${Math.max(0, Math.ceil(countdownSec))}s`;
}

/**
 * Default goal minute, derived from the server-authoritative clock
 * (1-based: a goal scored in the first running minute is "1'").
 * When the timer is paused, `pausedRemainingSec` is the frozen value.
 */
export function defaultGoalMinute(
  totalSeconds: number,
  timerEndsAtMs: number | null,
  pausedRemainingSec: number,
  now: number = Date.now(),
): number {
  const remaining =
    timerEndsAtMs != null
      ? Math.max(0, Math.ceil((timerEndsAtMs - now) / 1000))
      : Math.max(0, pausedRemainingSec);
  const elapsed = Math.max(0, totalSeconds - remaining);
  return Math.max(1, Math.ceil(elapsed / 60));
}

/** True when a claimed minute falls beyond the full match length (after the whistle). */
export function isAfterWhistle(
  minute: number,
  totalSeconds: number,
): boolean {
  const totalMinutes = Math.floor(totalSeconds / 60);
  return minute > totalMinutes;
}
