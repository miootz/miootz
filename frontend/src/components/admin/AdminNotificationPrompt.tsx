import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useNotificationPermission } from '../../utils/useNotificationPermission';

const DISMISS_KEY = 'miootz-admin-notify-prompt-dismissed';

/**
 * One-time style banner to request Web Notification permission (admin / power users).
 */
export function AdminNotificationPrompt() {
  const [permission, setPermission] = useNotificationPermission();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return true;
    }
  });

  if (typeof window === 'undefined') return null;
  if (permission !== 'default') {
    return null;
  }
  if (dismissed) return null;

  return (
    <div
      className="mb-4 flex flex-wrap items-start gap-3 border border-line bg-panel px-4 py-3 text-sm text-ink"
      role="region"
      aria-label="Notifications"
    >
      <Bell className="h-5 w-5 shrink-0 mt-0.5 text-live" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Get notified</p>
        <p className="text-ink-dim mt-0.5">
          Allow browser notifications for new meetups and roster changes when this app is in the
          background.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="bg-ink text-board px-3 py-1.5 text-xs font-bold hover:bg-white/90 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-live transition-colors"
            onClick={() => {
              void Notification.requestPermission().then(setPermission).catch(() => {});
            }}
          >
            Enable
          </button>
          <button
            type="button"
            className="border border-line px-3 py-1.5 text-xs font-medium text-ink-dim hover:bg-raised hover:text-ink"
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
        className="p-1 text-ink-faint hover:bg-raised hover:text-ink"
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
