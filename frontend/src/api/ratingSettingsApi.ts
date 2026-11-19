import { apiFetch, parseApiError } from "./client";

export type PeerRatingMode = "off" | "teammates-only" | "everyone";

export interface RatingSettings {
  computed_scores: boolean;
  peer_rating_mode: PeerRatingMode;
}

export async function fetchRatingSettings(): Promise<RatingSettings> {
  const response = await apiFetch("/rating-settings");
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<RatingSettings>;
}

export async function saveRatingSettings(settings: RatingSettings): Promise<RatingSettings> {
  const response = await apiFetch("/rating-settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<RatingSettings>;
}
