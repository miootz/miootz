import { useState } from 'react';
import { Bell, X } from 'lucide-react';

const DISMISS_KEY = 'miootz-admin-notify-prompt-dismissed';

/**
 * One-time style banner to request Web Notification permission (admin / power users).
 */
export function AdminNotificationPrompt() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return true;
    }
  });

  if (typeof window === 'undefined') return null;
  if (!('Notification' in window) || Notification.permission !== 'default') {
    return null;
  }
  if (dismissed) return null;

  return (
    <div
      className="mb-4 flex flex-wrap items-start gap-3 rounded-xl border border-teal-200 bg-teal-50/90 px-4 py-3 text-sm text-teal-950 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100"
      role="region"
      aria-label="Notifications"
    >
      <Bell className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Get notified</p>
        <p className="text-teal-800/90 dark:text-teal-200/90 mt-0.5">
          Allow browser notifications for new meetups and roster changes when this app is in the
          background.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors"
            onClick={() => {
              void Notification.requestPermission();
            }}
          >
            Enable
          </button>
          <button
            type="button"
            className="rounded-lg border border-teal-300 px-3 py-1.5 text-xs font-medium text-teal-900 hover:bg-white/80 dark:border-teal-800 dark:text-teal-100 dark:hover:bg-teal-900/50"
            onClick={() => {
              try {
                window.localStorage.setItem(DISMISS_KEY, '1');
              } catch {
                /* ignore */
              }
              setDismissed(true);
            }}
          >
            Not now
          </button>
        </div>
      </div>
      <button
        type="button"
        className="rounded-lg p-1 text-teal-800 hover:bg-teal-100 dark:text-teal-200 dark:hover:bg-teal-900/60"
        aria-label="Dismiss"
        onClick={() => {
          try {
            window.localStorage.setItem(DISMISS_KEY, '1');
          } catch {
            /* ignore */
          }
          setDismissed(true);
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
