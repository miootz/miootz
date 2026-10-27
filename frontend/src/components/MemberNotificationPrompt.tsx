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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Enable notifications"
    >
      <div className="w-full max-w-sm rounded-2xl border border-teal-200 bg-white p-6 shadow-2xl dark:border-teal-800 dark:bg-gray-900">
        <div className="flex items-start justify-between">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/40">
            <Bell
              className="h-6 w-6 text-teal-700 dark:text-teal-400"
              aria-hidden
            />
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 transition-colors"
            aria-label="Dismiss"
            onClick={dismiss}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <h2 className="mt-4 text-xl font-bold text-gray-900 dark:text-white">
          Never miss a kickoff
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          Get notified about kickoff reminders, roster changes, and chat
          messages — even when the app is in the background.
        </p>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-800 active:scale-[0.98] transition-colors"
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
            className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
            onClick={dismiss}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
