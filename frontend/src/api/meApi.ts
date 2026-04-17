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

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export async function fetchMe(): Promise<MeResponse | null> {
  const r = await apiFetch('/me');
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<MeResponse>;
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

export async function uploadMyAvatar(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await apiFetch('/users/me/avatar', {
    method: 'POST',
    body: fd,
    headers: {},
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  const j = (await r.json()) as { profile_pic: string };
  return j.profile_pic;
}

/** Same-origin path e.g. `/uploads/uuid.jpg` — works behind Vite `/uploads` proxy in dev. */
export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return path;
}
