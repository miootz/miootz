import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import {
  dismissInstallPrompt,
  engagementChangedEventName,
  getSessionViewCount,
  isInstallPromptDismissed,
} from '../offline/engagement';

/** Chromium `beforeinstallprompt` (not in all TS lib targets). */
interface PwaInstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Deferred PWA install prompt (Chrome/Edge/Android; Safari shows Add to Home separately). */
export function InstallAppBanner() {
  const [deferred, setDeferred] = useState<PwaInstallEvent | null>(null);
  const [sessionViews, setSessionViews] = useState(getSessionViewCount);

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

  const showBanner =
    deferred !== null &&
    !isInstallPromptDismissed() &&
    sessionViews >= 2;

  if (!showBanner) return null;

  return (
    <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 border-b border-violet-200 bg-violet-50 px-4 py-2 dark:border-violet-900/50 dark:bg-violet-950/40">
      <p className="min-w-0 flex-1 text-left text-sm text-violet-950 dark:text-violet-100">
        Install Footy Legends for quick access from your home screen.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          onClick={() => {
            void (async () => {
              await deferred.prompt();
              await deferred.userChoice;
              setDeferred(null);
            })();
          }}
        >
          <Download className="h-4 w-4" aria-hidden />
          Install
        </button>
        <button
          type="button"
          className="rounded-lg p-2 text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/50"
          aria-label="Dismiss"
          onClick={() => {
            dismissInstallPrompt();
            setDeferred(null);
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
