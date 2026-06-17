import type { ChatMessage } from '../types';
import { cacheGet, cachePut, getOfflineDb } from '../offline/db';
import { CACHE_SESSION_ACTIVE, cacheKeyChat } from '../offline/cacheKeys';

const LEGACY_SESSION_STORAGE_KEY = 'miootz:sessionChatCache';
const LEGACY_VERSION = 3;

/** One-time migration from sessionStorage (Phase 1) to IndexedDB. */
let migrationDone = false;

async function migrateFromSessionStorageOnce(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  try {
    const raw = sessionStorage.getItem(LEGACY_SESSION_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      v?: number;
      chatBySessionId?: Record<string, ChatMessage[]>;
    };
    if (parsed.v !== LEGACY_VERSION || !parsed.chatBySessionId) {
      sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
      return;
    }
    for (const [sid, messages] of Object.entries(parsed.chatBySessionId)) {
      await cachePut(cacheKeyChat(sid), messages);
    }
    sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Clears chat cache and active session snapshot (e.g. when meetup list is empty). */
export async function clearSessionChatCache(): Promise<void> {
  const db = await getOfflineDb();
  const keys = await db.getAllKeys('cache');
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    if (key.startsWith('chat:') || key === CACHE_SESSION_ACTIVE) {
      await db.delete('cache', key);
    }
  }
}

/** `undefined` = never cached; array (possibly empty) = known state from a prior load. */
export async function getCachedChatMessages(
  sessionId: string
): Promise<ChatMessage[] | undefined> {
  await migrateFromSessionStorageOnce();
  const env = await cacheGet<ChatMessage[]>(cacheKeyChat(sessionId));
  if (!env) return undefined;
  return env.data;
}

export async function setCachedChatMessages(
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  await migrateFromSessionStorageOnce();
  await cachePut(cacheKeyChat(sessionId), messages);
}

export async function appendCachedChatMessage(
  sessionId: string,
  message: ChatMessage
): Promise<void> {
  await migrateFromSessionStorageOnce();
  const env = await cacheGet<ChatMessage[]>(cacheKeyChat(sessionId));
  const prev = env?.data ?? [];
  if (prev.some((m) => m.id === message.id)) return;
  await cachePut(cacheKeyChat(sessionId), [...prev, message]);
}
