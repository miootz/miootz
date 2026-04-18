import { apiBase, parseApiError } from './client';

export interface BeginInviteResponse {
  username: string;
  email: string;
  setup_token: string;
}

export interface CompleteInviteResponse {
  redirect: string;
  username: string;
  manual_login?: boolean;
}

/** Public — no auth (invitee may not have SSO yet). */
export async function beginInviteVerify(token: string): Promise<BeginInviteResponse> {
  const base = apiBase();
  const r = await fetch(`${base}/invites/verify/begin`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<BeginInviteResponse>;
}

export async function completeInviteVerify(
  setup_token: string,
  password: string,
  password_confirm: string
): Promise<CompleteInviteResponse> {
  const base = apiBase();
  const r = await fetch(`${base}/invites/verify/complete`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ setup_token, password, password_confirm }),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<CompleteInviteResponse>;
}
