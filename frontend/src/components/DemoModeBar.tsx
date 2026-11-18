import { demoRoom } from '../utils/demoRoom';

/**
 * Thin top bar marking demo deploys (VITE_DEMO=1, set by `python -m app.demo`).
 * Tapping it returns to the /api/demo account/scenario picker. Plain anchor
 * (not a router Link): /api/demo is a server-rendered page, not an SPA route,
 * so it needs a full document load.
 */
export function DemoModeBar() {
  if (!import.meta.env.VITE_DEMO) return null;
  return (
    <a
      href="/api/demo"
      className="block border-b border-line bg-board py-1 text-center text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim hover:text-ink"
    >
      {demoRoom() ? 'All scenarios' : 'Demo mode — tap to return'}
    </a>
  );
}
