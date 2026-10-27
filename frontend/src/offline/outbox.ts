import { apiFetch } from '../api/client';
import {
  getOfflineDb,
  type OutboxItem,
  type OutboxRating,
  type OutboxChat,
} from './db';

export async function enqueueOutbox(item: Omit<OutboxChat, 'id' | 'createdAt'> & { id?: string } | Omit<OutboxRating, 'id' | 'createdAt'> & { id?: string }): Promise<string> {
  const db = await getOfflineDb();
  const id =
    (item as { id?: string }).id ??
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const full = {
    ...item,
    id,
    createdAt: Date.now(),
  } as OutboxItem;
  await db.put('outbox', full);
  return id;
}

export async function getAllOutbox(): Promise<OutboxItem[]> {
  const db = await getOfflineDb();
  return db.getAll('outbox');
}

export async function removeOutbox(id: string): Promise<void> {
  const db = await getOfflineDb();
  await db.delete('outbox', id);
}

/** Flush queued requests (call when online or from service worker sync). */
export async function processOutbox(): Promise<{ sent: number; failed: number }> {
  const items = await getAllOutbox();
  let sent = 0;
  let failed = 0;

  for (const item of items) {
    try {
      if (item.type === 'chat') {
        const r = await apiFetch(`/meetups/${item.meetupId}/chat`, {
          method: 'POST',
          body: JSON.stringify({ message: item.message }),
        });
        if (r.ok) {
          await removeOutbox(item.id);
          sent += 1;
        } else {
          failed += 1;
        }
      } else if (item.type === 'rating') {
        const r = await apiFetch('/ratings/', {
          method: 'POST',
          body: JSON.stringify({
            meetup_id: item.meetupId,
            ratee_id: item.rateeId,
            score: item.score,
          }),
        });
        if (r.ok) {
          await removeOutbox(item.id);
          sent += 1;
        } else {
          failed += 1;
        }
      }
    } catch {
      failed += 1;
    }
  }

  return { sent, failed };
}

export async function requestBackgroundSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sync = (
      reg as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }
    ).sync;
    if (sync) {
      await sync.register('miootz-outbox');
    }
  } catch {
    /* Sync API may be unavailable */
  }
}
