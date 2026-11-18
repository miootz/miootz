import { apiBase } from '../api/client';
import { demoRoom } from './demoRoom';

/** Mark a room active only when a signed-in visitor interacts with its visible page. */
export function startDemoActivity(accessToken: string): () => void {
  if (!demoRoom()) return () => {};
  let lastSent = 0;
  const onInteraction = (event: Event) => {
    const now = Date.now();
    if (!event.isTrusted || document.visibilityState !== 'visible' || now - lastSent < 30_000) return;
    lastSent = now;
    void fetch(`${apiBase()}/demo/activity`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      keepalive: true,
    }).catch(() => {});
  };
  const events = ['pointerdown', 'keydown', 'wheel'] as const;
  for (const event of events) window.addEventListener(event, onInteraction, { passive: true });
  return () => {
    for (const event of events) window.removeEventListener(event, onInteraction);
  };
}
