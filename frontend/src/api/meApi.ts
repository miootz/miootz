import { apiFetch, parseApiError } from './client';

export interface MeUser {
  id: number;
  username: string;
  email: string;
  full_name?: string | null;
  is_admin?: boolean;
}

export interface MeResponse {
  user: MeUser;
  is_admin: boolean;
  auth_groups: string[];
}

export async function fetchMe(): Promise<MeResponse | null> {
  const r = await apiFetch('/me');
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<MeResponse>;
}
