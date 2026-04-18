import { apiFetch, parseApiError } from './client';

export interface SSOIdentity {
  username: string | null;
  email: string | null;
  display_name: string | null;
}

export interface MeUser {
  id: number;
  username: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  profile_pic?: string | null;
  /** Full upload used only in the crop editor; omit for other users if API hides it. */
  profile_pic_original?: string | null;
  /** Natural-pixel crop on the original image; restores editor zoom/pan. */
  avatar_crop_pixels?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  skill_level?: number | null;
  self_assessed_skill?: number | null;
  calculated_skill?: number | null;
  is_admin?: boolean;
}

export interface MeResponse {
  user: MeUser;
  sso: SSOIdentity | null;
  is_admin: boolean;
  auth_groups: string[];
}

export interface UserStats {
  games_played: number;
  average_rating: number;
  total_ratings: number;
  skill_level: number;
}

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export async function fetchMe(): Promise<MeResponse | null> {
  const r = await apiFetch('/me');
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<MeResponse>;
}

export async function fetchMyStats(): Promise<UserStats> {
  const r = await apiFetch('/users/me/stats');
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<UserStats>;
}

export async function patchMyProfile(
  body: Record<string, unknown>
): Promise<void> {
  const r = await apiFetch('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
}

export async function uploadMyAvatar(file: File): Promise<{
  profile_pic: string;
  profile_pic_original: string;
}> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await apiFetch('/users/me/avatar', {
    method: 'POST',
    body: fd,
    headers: {},
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<{
    profile_pic: string;
    profile_pic_original: string;
    avatar_crop_pixels: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
}

export async function saveAvatarCrop(crop: {
  crop_pixels: { x: number; y: number; width: number; height: number };
}): Promise<{
  profile_pic: string;
  avatar_crop_pixels: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}> {
  const r = await apiFetch('/users/me/avatar/crop', {
    method: 'POST',
    body: JSON.stringify(crop),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<{
    profile_pic: string;
    avatar_crop_pixels: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
}

/** Same-origin path e.g. `/uploads/uuid.jpg` — works behind Vite `/uploads` proxy in dev. */
export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return path;
}
