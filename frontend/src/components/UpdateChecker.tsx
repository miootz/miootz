import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext';

const POLL_MS = 60_000;

/**
 * Offers a one-tap reload when a new build is deployed: compares the entry
 * script in the server's index.html (hashed in prod builds) against the one
 * currently loaded. Dev builds have no hash — Vite HMR handles reloads there,
 * so the check is skipped.
 */
export function UpdateChecker() {
  const { showToast } = useToast();
  const announced = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const current = document.querySelector<HTMLScriptElement>('script[src]')
      ?.src;
    if (!current) return;

    const check = async () => {
      if (announced.current) return;
      try {
        const res = await fetch(import.meta.env.BASE_URL, { cache: 'no-store' });
        if (!res.ok) return;
        const html = await res.text();
        const next = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
        if (next && next !== current) {
          announced.current = true;
          // Version = build hash from the entry script name (unique per build).
          const v = next.match(/[-.]([A-Za-z0-9_-]{6,})\.(?:js|css)$/)?.[1];
          showToast(
            `An app update is available${v ? ` (v${v.slice(0, 8)})` : ''}.`,
            'default',
            0,
            { label: 'Update now', onClick: () => window.location.reload() },
          );
        }
      } catch {
        // offline — the next poll retries
      }
    };

    void check();
    const iv = setInterval(check, POLL_MS);
    return () => clearInterval(iv);
  }, [showToast]);

  return null;
}
