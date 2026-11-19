import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { pushSupported, subscribeToWebPush } from '../../utils/pushSubscription';
import { useNotificationPermission } from '../../utils/useNotificationPermission';
import { roomStorageKey } from '../../utils/demoRoom';

const DISMISS_KEY = roomStorageKey('miootz-admin-notify-prompt-dismissed');

/**
 * One-time style banner to request Web Notification permission (admin / power users).
 */
export function AdminNotificationPrompt() {
  const [permission, setPermission] = useNotificationPermission();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return true;
    }
  });

  if (!pushSupported()) return null;
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
            disabled={busy}
            className="bg-ink text-board px-3 py-1.5 text-xs font-bold hover:bg-white/90 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-live transition-colors disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              const result = await subscribeToWebPush(() => setPermission('granted'));
              setPermission(Notification.permission);
              setBusy(false);
              if (result.ok) {
                showToast('Notifications enabled', 'success');
              } else if (result.reason !== 'Notification permission denied') {
                showToast(result.reason ?? 'Could not enable notifications', 'error');
              }
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
