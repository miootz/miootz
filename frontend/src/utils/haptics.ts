/** Mobile vibration patterns — no-ops when unsupported or reduced-motion preference. */

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  navigator.vibrate(pattern);
}

export function hapticLight(): void {
  if (prefersReducedMotion()) return;
  vibrate(12);
}

export function hapticSuccess(): void {
  if (prefersReducedMotion()) return;
  vibrate([15, 40, 20]);
}

export function hapticError(): void {
  if (prefersReducedMotion()) return;
  vibrate([30, 50, 30, 50, 30]);
}

/**
 * iOS has no Web Vibration API; the Taptic Engine only pulses when an audio
 * element starts playing (iOS 26.5+ dropped script-driven switch ticks).
 * Workaround: fire a tiny silent WAV — the system clicks once per play.
 * "Longer" = more ticks, since each tick is a fixed system click.
 */
export const IS_IOS =
  typeof navigator !== 'undefined' &&
  /iPhone|iPad|iPod/.test(navigator.userAgent);

export function hapticsEnabled(): boolean {
  return !prefersReducedMotion();
}

/** Toggle-switch tap: short pulse (iOS ticks come from the native switch overlay). */
export function hapticToggle(): void {
  if (!hapticsEnabled()) return;
  vibrate(10);
}

// ~2 ms of silence, 16-bit mono 44.1 kHz.
const SILENT_TICK =
  'data:audio/wav;base64,UklGRtgAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YbQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

let tickAudio: HTMLAudioElement | null = null;

function scheduleTicks(count: number): void {
  for (let i = 0; i < count; i++) {
    window.setTimeout(() => {
      if (!tickAudio) tickAudio = new Audio(SILENT_TICK);
      tickAudio.currentTime = 0;
      void tickAudio.play().catch(() => {});
    }, i * 90);
  }
}

/** Half-time: brief pulse (iOS: two ticks). */
export function hapticHalfTime(): void {
  if (prefersReducedMotion()) return;
  if (IS_IOS) scheduleTicks(2);
  else vibrate([30, 50, 30]);
}

/** Full-time: longer pulse (iOS: four ticks). */
export function hapticFinal(): void {
  if (prefersReducedMotion()) return;
  if (IS_IOS) scheduleTicks(4);
  else vibrate([80, 60, 80, 60, 160]);
}
