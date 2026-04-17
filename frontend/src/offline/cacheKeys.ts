export const CACHE_SESSION_ACTIVE = 'session:active';
export const CACHE_PROFILE_ME = 'profile:me';

export function cacheKeyChat(sessionId: string): string {
  return `chat:${sessionId}`;
}

export function cacheKeyRatingContext(sessionId: number): string {
  return `ratingContext:${sessionId}`;
}
