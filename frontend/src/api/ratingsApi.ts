import { apiFetch, parseApiError } from './client';

export interface RateeContext {
  user_id: number;
  display_name: string;
  avatar_url: string | null;
  my_score: number | null;
}

export interface RatingContextResponse {
  session_id: number;
  session_start_time: string;
  session_end_time: string;
  before_session_end: boolean;
  ratings_locked: boolean;
  ratings_editable: boolean;
  ratings_lock_at: string | null;
  viewer_attended: boolean;
  ratees: RateeContext[];
}

export async function fetchRatingContext(
  sessionId: number
): Promise<RatingContextResponse> {
  const r = await apiFetch(`/ratings/sessions/${sessionId}/context`);
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<RatingContextResponse>;
}

export async function submitRating(
  sessionId: number,
  rateeId: number,
  score: number
): Promise<void> {
  const r = await apiFetch('/ratings/', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      ratee_id: rateeId,
      score,
    }),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
}
