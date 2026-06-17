import { useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import {
  engagementChangedEventName,
  getSessionViewCount,
} from '../offline/engagement';
import { isDisplayModeStandalone, isIosSafari } from '../utils/pwaDetect';
import { useOverlayLock } from '../context/OverlayLock';

/** Chromium `beforeinstallprompt` (not in all TS lib targets). */
interface PwaInstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Full-screen PWA install overlay.
 *
 * Shown every session (not persisted across reloads) to push users toward
 * installing the app instead of using it in a browser tab.
 * Dismissing only hides it for the current page session.
 */
export function InstallAppBanner() {
  const { tryAcquire, release } = useOverlayLock();
  const [lockAcquired, setLockAcquired] = useState(false);
  const [deferred, setDeferred] = useState<PwaInstallEvent | null>(null);
  const [_sessionViews, setSessionViews] = useState(getSessionViewCount);
  const [standalone, setStandalone] = useState(isDisplayModeStandalone);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as PwaInstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  useEffect(() => {
    const sync = () => setSessionViews(getSessionViewCount());
    window.addEventListener(engagementChangedEventName, sync);
    return () => window.removeEventListener(engagementChangedEventName, sync);
  }, []);

  // Watch for display-mode changes (user installs while overlay is open)
  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const handler = () => setStandalone(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Acquire the overlay lock in an effect (not during render) to avoid
  // "Cannot update a component while rendering a different component".
  useEffect(() => {
    if (!lockAcquired) {
      setLockAcquired(tryAcquire('install'));
    }
  }, [tryAcquire, lockAcquired]);

  // Don't show if already installed (standalone mode)
  if (standalone) return null;

  // Don't show if user dismissed for this session
  if (dismissedThisSession) return null;

  // Show if we have a Chromium install prompt
  const showChromium = deferred !== null;
  // Show Safari hint after any engagement
  const showSafariHint = isIosSafari();

  if (!showChromium && !showSafariHint) return null;

  if (!lockAcquired) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Install Miootz"
    >
      <div className="w-full max-w-sm rounded-2xl border border-violet-200 bg-white p-6 shadow-2xl dark:border-violet-800 dark:bg-gray-900">
        <div className="flex items-start justify-between">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/40">
            <Smartphone className="h-6 w-6 text-violet-600 dark:text-violet-400" aria-hidden />
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 transition-colors"
            aria-label="Dismiss"
            onClick={() => {
              release('install');
              setDismissedThisSession(true);
            }}
          >
            <X size={18} />
          </button>
        </div>

        <h2 className="mt-4 text-xl font-bold text-gray-900 dark:text-white">
          Install Miootz
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          Get instant access from your home screen, push notifications for kickoff reminders, and a
          faster app experience.
        </p>

        {showSafariHint && (
          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-950/30">
            <p className="text-sm font-medium text-violet-950 dark:text-violet-100">
              On iPhone, use the Share button to install:
            </p>
            <ol className="mt-2 space-y-1.5 text-sm text-violet-800 dark:text-violet-200/90">
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-200 text-xs font-bold text-violet-800 dark:bg-violet-800 dark:text-violet-200">
                  1
                </span>
                Tap the{' '}
                <span className="font-semibold">Share</span>{' '}
                <span className="text-lg">⬆</span> button at the bottom
              </li>
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-200 text-xs font-bold text-violet-800 dark:bg-violet-800 dark:text-violet-200">
                  2
                </span>
                Scroll and tap{' '}
                <span className="font-semibold">Add to Home Screen</span>
              </li>
            </ol>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          {showChromium && (
            <button
              type="button"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 active:scale-[0.98] transition-colors"
              onClick={() => {
                void (async () => {
                  await deferred.prompt();
                  const choice = await deferred.userChoice;
                  if (choice.outcome === 'accepted') {
                    setDeferred(null);
                  } else {
                    setDismissedThisSession(true);
                  }
                })();
              }}
            >
              <Download className="h-4 w-4" aria-hidden />
              Install app
            </button>
          )}
          <button
            type="button"
            className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
            onClick={() => {
              release('install');
              setDismissedThisSession(true);
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
