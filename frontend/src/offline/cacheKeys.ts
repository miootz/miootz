export const CACHE_MEETUP_ACTIVE = 'meetup:active';
export const CACHE_PROFILE_ME = 'profile:me';

export function cacheKeyChat(meetupId: string): string {
  return `chat:${meetupId}`;
}

export function cacheKeyRatingContext(meetupId: number): string {
  return `ratingContext:${meetupId}`;
}
