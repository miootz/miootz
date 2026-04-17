import { apiBase, parseApiError } from './client';

export interface VerifyInviteResponse {
  message: string;
  username: string;
  email: string;
}

/** Public — no auth (invitee may not have SSO yet). */
export async function verifyInviteToken(
  token: string
): Promise<VerifyInviteResponse> {
  const base = apiBase();
  const url = `${base}/invites/verify/${encodeURIComponent(token)}`;
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<VerifyInviteResponse>;
}
