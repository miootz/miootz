/** Mobile vibration patterns — no-ops when unsupported or reduced-motion preference. */

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function hapticLight(): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  if (prefersReducedMotion()) return;
  navigator.vibrate(12);
}

export function hapticSuccess(): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  if (prefersReducedMotion()) return;
  navigator.vibrate([15, 40, 20]);
}

export function hapticError(): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  if (prefersReducedMotion()) return;
  navigator.vibrate([30, 50, 30, 50, 30]);
}
