import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { subscribeToWebPush, pushSupported } from "../utils/pushSubscription";
import { useToast } from "../context/ToastContext";
import { useOverlayLock } from "../context/OverlayLock";

const SHOW_DELAY_MS = 8000; // Show after 8 seconds (after install prompt has time to appear)

/**
 * Full-screen notification permission overlay.
 *
 * Shown every meetup to push users toward enabling push notifications.
 * Dismissing only hides it for the current page meetup.
 */
export function MemberNotificationPrompt({
  enabled = true,
}: {
  enabled?: boolean;
}) {
  const { showToast } = useToast();
  const { tryAcquire, release } = useOverlayLock();
  const lockAcquiredRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [dismissedThisSession, setDismissedThisMeetup] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (dismissedThisSession) return;
    if (typeof window === "undefined") return;
    if (!pushSupported()) return;
    if (!("Notification" in window) || Notification.permission !== "default")
      return;

    const timer = setTimeout(() => {
      // Try to acquire the lock when timer fires
      if (!lockAcquiredRef.current && tryAcquire("notifications")) {
        lockAcquiredRef.current = true;
        setVisible(true);
      }
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dismissedThisSession, tryAcquire, enabled]);

  // If disabled while holding the lock, release it so other overlays can show
  useEffect(() => {
    if (!enabled && lockAcquiredRef.current) {
      release("notifications");
      lockAcquiredRef.current = false;
      // One-shot release on disable; guarded by lockAcquiredRef so no cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(false);
    }
  }, [enabled, release]);

  if (!enabled || !visible) return null;

  const dismiss = () => {
    release("notifications");
    lockAcquiredRef.current = false;
    setVisible(false);
    setDismissedThisMeetup(true);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Enable notifications"
    >
      <div className="w-full max-w-sm border border-line bg-panel p-6 shadow-lg">
        <div className="flex items-start justify-between">
          <div className="flex h-12 w-12 items-center justify-center bg-raised">
            <Bell
              className="h-6 w-6 text-ink-dim"
              aria-hidden
            />
          </div>
          <button
            type="button"
            className="p-1.5 text-ink-faint hover:bg-raised hover:text-ink transition-colors"
            aria-label="Dismiss"
            onClick={dismiss}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <h2 className="mt-4 text-xl font-bold text-ink">
          Never miss a kickoff
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-dim">
          Get notified about kickoff reminders, roster changes, and chat
          messages — even when the app is in the background.
        </p>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            className="inline-flex flex-1 items-center justify-center gap-2 bg-ink px-4 py-3 text-sm font-bold text-board hover:bg-white/90 active:scale-[0.98] transition-colors"
            onClick={async () => {
              const result = await subscribeToWebPush();
              dismiss();
              if (result.ok) {
                showToast("Notifications enabled", "success");
              } else if (result.reason !== "Notification permission denied") {
                showToast(
                  result.reason ?? "Could not enable notifications",
                  "error",
                );
              }
            }}
          >
            <Bell className="h-4 w-4" aria-hidden />
            Enable notifications
          </button>
          <button
            type="button"
            className="border border-line px-4 py-3 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
            onClick={dismiss}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
