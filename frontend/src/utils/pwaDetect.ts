/**
 * PWA install detection utilities.
 *
 * Installed apps use standalone display mode. iOS also exposes a
 * non-standard `navigator.standalone` flag for home screen launches.
 */

let cachedIsInstalled: boolean | null = null;
let cachedIsChromium: boolean | null = null;

/** Check if the app is running in standalone (installed) mode. */
export function isDisplayModeStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Check for mobile devices, including iPadOS using a desktop user agent. */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgentData = (navigator as Navigator & { userAgentData?: { mobile: boolean } }).userAgentData;
  return userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
  const isIos = /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isSafari && isIos;
}

/**
 * Detect if the PWA appears to be already installed.
 *
 * Detects a home screen launch, not whether an app is installed elsewhere.
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
