import { useEffect, useState } from "react";
import { Download, Smartphone, X } from "lucide-react";
import { isDisplayModeStandalone, isIosSafari, isMobileDevice } from "../utils/pwaDetect";
import { useOverlayLock } from "../context/OverlayLock";

/** Chromium `beforeinstallprompt` (not in all TS lib targets). */
interface PwaInstallEvent extends Event {
  prompt: () => Promise<void>;
}

/**
 * Full-screen PWA install overlay.
 *
 * Shown every meetup (not persisted across reloads) to push users toward
 * installing the app instead of using it in a browser tab.
 * Dismissing only hides it for the current page meetup.
 */
export function InstallAppBanner({ enabled = true }: { enabled?: boolean }) {
  const { tryAcquire, release } = useOverlayLock();
  const [lockAcquired, setLockAcquired] = useState(false);
  const [deferred, setDeferred] = useState<PwaInstallEvent | null>(null);
  const [standalone, setStandalone] = useState(isDisplayModeStandalone);
  const [dismissedThisSession, setDismissedThisMeetup] = useState(false);
  const showChromium = deferred !== null;
  const showSafariHint = isIosSafari();
  const shouldShow = enabled && !standalone && !dismissedThisSession &&
    isMobileDevice() && (showChromium || showSafariHint);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      if (!isMobileDevice() || isDisplayModeStandalone()) return;
      e.preventDefault();
      setDeferred(e as PwaInstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  // Watch for display-mode changes (user installs while overlay is open)
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const handler = () => setStandalone(isDisplayModeStandalone());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Acquire the overlay lock in an effect (not during render) to avoid
  // "Cannot update a component while rendering a different component".
  useEffect(() => {
    // One-shot lock acquire; guarded by lockAcquired so it never cascades.
    if (!lockAcquired && shouldShow) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLockAcquired(tryAcquire("install"));
    }
  }, [tryAcquire, lockAcquired, shouldShow]);

  // Release the lock whenever the overlay can no longer be shown.
  useEffect(() => {
    if (!shouldShow && lockAcquired) {
      release("install");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLockAcquired(false);
    }
  }, [shouldShow, lockAcquired, release]);

  useEffect(() => () => release("install"), [release]);

  // Don't show when suppressed (e.g. offline — a lower-priority banner is up)
  if (!shouldShow) return null;

  if (!lockAcquired) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Install Miootz"
    >
      <div className="w-full max-w-sm border border-line bg-panel p-6 shadow-lg">
        <div className="flex items-start justify-between">
          <div className="flex h-12 w-12 items-center justify-center bg-raised">
            <Smartphone
              className="h-6 w-6 text-ink-dim"
              aria-hidden
            />
          </div>
          <button
            type="button"
            className="p-1.5 text-ink-faint hover:bg-raised hover:text-ink transition-colors"
            aria-label="Dismiss"
            onClick={() => {
              release("install");
              setDismissedThisMeetup(true);
            }}
          >
            <X size={18} />
          </button>
        </div>

        <h2 className="mt-4 text-xl font-bold text-ink">
          Install Miootz
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-dim">
          Get instant access from your home screen, push notifications for
          kickoff reminders, and a faster app experience.
        </p>

        {showSafariHint && (
          <div className="mt-4 border border-line p-3">
            <p className="text-sm font-medium text-ink-dim">
              On iPhone or iPad, use the Share button to install:
            </p>
            <ol className="mt-2 space-y-1.5 text-sm text-ink-faint">
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center bg-raised text-xs font-bold text-ink-dim">
                  1
                </span>
                Tap the <span className="font-semibold text-ink">Share</span>{" "}
                <span className="text-lg">⬆</span> button at the bottom
              </li>
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center bg-raised text-xs font-bold text-ink-dim">
                  2
                </span>
                Scroll and tap{" "}
                <span className="font-semibold text-ink">Add to Home Screen</span>
              </li>
            </ol>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          {showChromium && (
            <button
              type="button"
              className="inline-flex flex-1 items-center justify-center gap-2 bg-ink px-4 py-3 text-sm font-bold text-board hover:bg-white/90 active:scale-[0.98] transition-colors"
              onClick={() => {
                setDeferred(null);
                setDismissedThisMeetup(true);
                void deferred?.prompt().catch(() => {});
              }}
            >
              <Download className="h-4 w-4" aria-hidden />
              Install app
            </button>
          )}
          <button
            type="button"
            className="border border-line px-4 py-3 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
            onClick={() => {
              release("install");
              setDismissedThisMeetup(true);
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
