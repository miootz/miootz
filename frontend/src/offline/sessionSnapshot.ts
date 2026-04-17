import type { Session } from '../types';
import { cacheGet, cachePut } from './db';
import { CACHE_SESSION_ACTIVE } from './cacheKeys';

export async function saveSessionSnapshot(session: Session): Promise<void> {
  await cachePut(CACHE_SESSION_ACTIVE, session);
}

export async function loadSessionSnapshot(): Promise<{
  session: Session;
  updatedAt: number;
} | null> {
  const env = await cacheGet<Session>(CACHE_SESSION_ACTIVE);
  if (!env?.data) return null;
  return { session: env.data, updatedAt: env.updatedAt };
}
