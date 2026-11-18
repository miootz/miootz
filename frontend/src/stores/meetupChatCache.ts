import type { ChatMessage } from '../types';
import { cacheGet, cachePut, getOfflineDb } from '../offline/db';
import { CACHE_MEETUP_ACTIVE, cacheKeyChat } from '../offline/cacheKeys';
import { roomStorageKey } from '../utils/demoRoom';

const LEGACY_MEETUP_STORAGE_KEY = roomStorageKey('miootz:meetupChatCache');
const LEGACY_VERSION = 3;

/** One-time migration from sessionStorage (Phase 1) to IndexedDB. */
let migrationDone = false;

async function migrateFromSessionStorageOnce(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  try {
    const raw = sessionStorage.getItem(LEGACY_MEETUP_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      v?: number;
      chatByMeetupId?: Record<string, ChatMessage[]>;
    };
    if (parsed.v !== LEGACY_VERSION || !parsed.chatByMeetupId) {
      sessionStorage.removeItem(LEGACY_MEETUP_STORAGE_KEY);
      return;
    }
    for (const [sid, messages] of Object.entries(parsed.chatByMeetupId)) {
      await cachePut(cacheKeyChat(sid), messages);
    }
    sessionStorage.removeItem(LEGACY_MEETUP_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Clears chat cache and active meetup snapshot (e.g. when meetup list is empty). */
export async function clearMeetupChatCache(): Promise<void> {
  const db = await getOfflineDb();
  const keys = await db.getAllKeys('cache');
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    if (key.startsWith('chat:') || key === CACHE_MEETUP_ACTIVE) {
      await db.delete('cache', key);
    }
  }
}

/** `undefined` = never cached; array (possibly empty) = known state from a prior load. */
export async function getCachedChatMessages(
  meetupId: string
): Promise<ChatMessage[] | undefined> {
  await migrateFromSessionStorageOnce();
  const env = await cacheGet<ChatMessage[]>(cacheKeyChat(meetupId));
  if (!env) return undefined;
  return env.data;
}

export async function setCachedChatMessages(
  meetupId: string,
  messages: ChatMessage[]
): Promise<void> {
  await migrateFromSessionStorageOnce();
  await cachePut(cacheKeyChat(meetupId), messages);
}

export async function appendCachedChatMessage(
  meetupId: string,
  message: ChatMessage
): Promise<void> {
  await migrateFromSessionStorageOnce();
  const env = await cacheGet<ChatMessage[]>(cacheKeyChat(meetupId));
  const prev = env?.data ?? [];
  if (prev.some((m) => m.id === message.id)) return;
  await cachePut(cacheKeyChat(meetupId), [...prev, message]);
}
