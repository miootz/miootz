import { apiFetch, parseApiError } from './client';

export interface RateeContext {
  user_id: number;
  display_name: string;
  avatar_url: string | null;
  my_score: number | null;
}

export interface RatingContextResponse {
  peer_rating_mode?: "off" | "teammates-only" | "everyone";
  meetup_id: number;
  meetup_start_time: string;
  meetup_end_time: string;
  before_meetup_end: boolean;
  ratings_locked: boolean;
  ratings_editable: boolean;
  ratings_lock_at: string | null;
  viewer_attended: boolean;
  ratees: RateeContext[];
}

export async function fetchRatingContext(
  meetupId: number
): Promise<RatingContextResponse> {
  const r = await apiFetch(`/ratings/meetups/${meetupId}/context`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<RatingContextResponse>;
}

export async function submitRating(
  meetupId: number,
  rateeId: number,
  score: number
): Promise<void> {
  const r = await apiFetch('/ratings/', {
    method: 'POST',
    body: JSON.stringify({
      meetup_id: meetupId,
      ratee_id: rateeId,
      score,
    }),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
}
