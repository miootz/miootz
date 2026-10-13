import { describe, it, expect } from 'vitest';
import {
  leaseBusyLabel,
  leaseCountdown,
  leaseActive,
  leaseFromExpiresIn,
  defaultGoalMinute,
  isAfterWhistle,
} from '../utils/lease';

const NOW = 1_700_000_000_000; // fixed wall-clock anchor

describe('leaseCountdown', () => {
  it('is 0 without a lease', () => {
    expect(leaseCountdown(null, NOW)).toBe(0);
    expect(leaseActive(null, NOW)).toBe(false);
  });

  it('counts down from expiry, ceiling to whole seconds', () => {
    const lease = leaseFromExpiresIn('Carlos', 45, false, NOW);
    expect(leaseCountdown(lease, NOW)).toBe(45);
    expect(leaseCountdown(lease, NOW + 44_500)).toBe(1);
    expect(leaseCountdown(lease, NOW + 45_000)).toBe(0);
    // expired stays 0, never negative
    expect(leaseCountdown(lease, NOW + 60_000)).toBe(0);
    expect(leaseActive(lease, NOW + 10_000)).toBe(true);
    expect(leaseActive(lease, NOW + 60_000)).toBe(false);
  });

  it('clamps negative expiresIn to 0 when building from API value', () => {
    const lease = leaseFromExpiresIn('Carlos', -5, true, NOW);
    expect(leaseCountdown(lease, NOW)).toBe(0);
  });
});

describe('leaseBusyLabel', () => {
  it('names the holder with whole-second countdown', () => {
    expect(leaseBusyLabel('Carlos', 38.2)).toBe(
      'Carlos is entering a goal… 39s',
    );
    expect(leaseBusyLabel('Carlos', 0)).toBe('Carlos is entering a goal… 0s');
    expect(leaseBusyLabel('Carlos', -3)).toBe('Carlos is entering a goal… 0s');
  });
});

describe('defaultGoalMinute', () => {
  const TOTAL = 90 * 60;

  it('is 1 during the first running minute', () => {
    expect(defaultGoalMinute(TOTAL, NOW + TOTAL * 1000, 0, NOW)).toBe(1);
    expect(defaultGoalMinute(TOTAL, NOW + TOTAL * 1000 - 59_000, 0, NOW)).toBe(1);
  });

  it('derives from the shared end timestamp, ceiling', () => {
    // 10 full minutes elapsed of a 90' match -> minute 10 (601st second starts 11')
    expect(defaultGoalMinute(TOTAL, NOW + TOTAL * 1000 - 600_000, 0, NOW)).toBe(10);
    // 1 second into the match is still minute 1
    expect(defaultGoalMinute(TOTAL, NOW + TOTAL * 1000 - 1_000, 0, NOW)).toBe(1);
  });

  it('uses the frozen value while paused', () => {
    // paused with 45:00 left of a 90' match -> 45' elapsed -> minute 45
    expect(defaultGoalMinute(TOTAL, null, 45 * 60, NOW)).toBe(45);
    // paused at 0 remaining -> full match elapsed
    expect(defaultGoalMinute(TOTAL, null, 0, NOW)).toBe(90);
  });

  it('never returns below 1 (clock skew clamps elapsed to 0)', () => {
    // end timestamp slightly past full length (server rounding)
    expect(defaultGoalMinute(TOTAL, NOW + TOTAL * 1000 + 5_000, 0, NOW)).toBe(1);
    expect(defaultGoalMinute(TOTAL, null, -10, NOW)).toBe(90);
  });
});

describe('isAfterWhistle', () => {
  it('flags minutes beyond full match length', () => {
    expect(isAfterWhistle(90, 90 * 60)).toBe(false);
    expect(isAfterWhistle(91, 90 * 60)).toBe(true);
    expect(isAfterWhistle(1, 90 * 60)).toBe(false);
  });
});
