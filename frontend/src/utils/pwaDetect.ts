/**
 * PWA install detection utilities.
 *
 * Detection strategy:
 * 1. `display-mode: standalone` media query — true when running as installed PWA (all browsers).
 * 2. `beforeinstallprompt` event — fires only when the browser can offer install (Chromium).
 *    If it never fires, the app is likely already installed.
 * 3. Safari on iOS has no install event — users must manually "Add to Home Screen".
 */

let cachedIsInstalled: boolean | null = null;
let cachedIsChromium: boolean | null = null;

/** Check if the app is running in standalone (installed) mode. */
export function isDisplayModeStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches;
}

/** Check if the browser is Chromium-based (Chrome, Edge, Brave, Android Chrome). */
export function isChromiumBrowser(): boolean {
  if (cachedIsChromium !== null) return cachedIsChromium;
  if (typeof navigator === 'undefined') {
    cachedIsChromium = false;
    return false;
  }
  // Brave exposes `brave` on navigator; Edge has `Edg`; Chrome has `Chrome` but not `Safari`.
  const ua = navigator.userAgent;
  cachedIsChromium =
    /Chrome/.test(ua) &&
    !/Edg/.test(ua) &&
    !/OPR/.test(ua) &&
    !/SamsungBrowser/.test(ua);
  // Also true for Edge — it supports beforeinstallprompt too.
  if (/Edg/.test(ua)) cachedIsChromium = true;
  return cachedIsChromium;
}

/** Check if the browser is Safari on iOS (the one that requires manual install). */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Safari on iOS: has Safari but not Chrome/Edg/OPR, and has Mobile.
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua) && !/Edg/.test(ua) && !/OPR/.test(ua);
  const isIos = /iPhone|iPad|iPod/.test(ua);
  return isSafari && isIos;
}

/**
 * Detect if the PWA appears to be already installed.
 *
 * Returns `true` if:
 * - Running in standalone display mode, OR
 * - `beforeinstallprompt` was never fired on Chromium (likely already installed)
 *
 * For Safari on iOS, this always returns `false` because there's no programmatic
 * way to detect a manual "Add to Home Screen". Use `isIosSafari()` separately.
 */
export function isPwaInstalled(): boolean {
  if (cachedIsInstalled !== null) return cachedIsInstalled;
  cachedIsInstalled = isDisplayModeStandalone();
  return cachedIsInstalled;
}

/**
 * Reset the cached detection (e.g. after a display-mode change).
 * Call this when the `beforeinstallprompt` event fires (means NOT installed).
 */
export function resetPwaDetection(): void {
  cachedIsInstalled = null;
  cachedIsChromium = null;
}
