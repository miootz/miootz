import type { Meetup } from '../types';
import { cacheGet, cachePut } from './db';
import { CACHE_MEETUP_ACTIVE } from './cacheKeys';

export async function saveMeetupSnapshot(meetup: Meetup): Promise<void> {
  await cachePut(CACHE_MEETUP_ACTIVE, meetup);
}

export async function loadMeetupSnapshot(): Promise<{
  meetup: Meetup;
  updatedAt: number;
} | null> {
  const env = await cacheGet<Meetup>(CACHE_MEETUP_ACTIVE);
  if (!env?.data) return null;
  return { meetup: env.data, updatedAt: env.updatedAt };
}
