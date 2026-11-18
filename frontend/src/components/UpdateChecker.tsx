import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext';
import { demoRoom } from '../utils/demoRoom';

const POLL_MS = 60_000;

async function updateAndReload() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if ('serviceWorker' in navigator) {
      await Promise.race([
        navigator.serviceWorker.getRegistration().then((registration) => registration?.update()),
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, 3_000); }),
      ]);
    }
  } catch {
    // Registration retries after reload if the worker update fails.
  } finally {
    clearTimeout(timeout);
    window.location.reload();
  }
}

export function UpdateChecker() {
  const { showToast } = useToast();
  const announced = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const current = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (!current) return;
    const currentVersion = document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content;
    const room = demoRoom();
    const url = new URL(room ? `${room}/` : import.meta.env.BASE_URL, window.location.href);
    let stopped = false;

    const check = async () => {
      if (announced.current) return;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const html = await res.text();
        if (stopped || announced.current) return;
        const nextDocument = new DOMParser().parseFromString(html, 'text/html');
        const next = nextDocument.querySelector('script[type="module"][src]')?.getAttribute('src');
        const version = nextDocument.querySelector('meta[name="app-version"]')?.getAttribute('content');
        if (next && (new URL(next, res.url || url).href !== current ||
            (currentVersion && version && currentVersion !== version))) {
          announced.current = true;
          showToast(
            `An app update is available${version ? ` (v${version})` : ''}.`,
            'default',
            0,
            { label: 'Update now', onClick: () => { void updateAndReload(); } },
          );
        }
      } catch {
        // Offline or invalid response: the next poll retries.
      }
    };

    void check();
    const interval = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [showToast]);

  return null;
}
