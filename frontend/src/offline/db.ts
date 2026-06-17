import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const OFFLINE_DB_NAME = 'miootz-offline';
export const OFFLINE_DB_VERSION = 1;

export interface CacheEnvelope<T = unknown> {
  updatedAt: number;
  data: T;
}

interface MiootzOfflineSchema extends DBSchema {
  cache: {
    key: string;
    value: CacheEnvelope;
  };
  outbox: {
    key: string;
    value: OutboxItem;
  };
}

export type OutboxChat = {
  id: string;
  type: 'chat';
  sessionId: string;
  message: string;
  createdAt: number;
};

export type OutboxRating = {
  id: string;
  type: 'rating';
  sessionId: number;
  rateeId: number;
  score: number;
  createdAt: number;
};

export type OutboxItem = OutboxChat | OutboxRating;

let dbPromise: Promise<IDBPDatabase<MiootzOfflineSchema>> | null = null;

export function getOfflineDb(): Promise<IDBPDatabase<MiootzOfflineSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<MiootzOfflineSchema>(
      OFFLINE_DB_NAME,
      OFFLINE_DB_VERSION,
      {
        upgrade(db) {
          if (!db.objectStoreNames.contains('cache')) {
            db.createObjectStore('cache');
          }
          if (!db.objectStoreNames.contains('outbox')) {
            db.createObjectStore('outbox', { keyPath: 'id' });
          }
        },
      }
    );
  }
  return dbPromise;
}

export async function cachePut<T>(key: string, data: T): Promise<void> {
  const db = await getOfflineDb();
  const envelope: CacheEnvelope<T> = {
    updatedAt: Date.now(),
    data,
  };
  await db.put('cache', envelope as CacheEnvelope, key);
}

export async function cacheGet<T>(key: string): Promise<CacheEnvelope<T> | undefined> {
  const db = await getOfflineDb();
  return db.get('cache', key) as Promise<CacheEnvelope<T> | undefined>;
}

export async function cacheDelete(key: string): Promise<void> {
  const db = await getOfflineDb();
  await db.delete('cache', key);
}
