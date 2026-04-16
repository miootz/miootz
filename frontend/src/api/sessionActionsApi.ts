import { apiFetch, parseApiError } from './client';

/** Process signed email link token (confirm / cancel / reactivate). */
export async function postSessionLinkAction(
  token: string
): Promise<{ message: string }> {
  const r = await apiFetch('/session-links/action', {
    method: 'POST',
    body: JSON.stringify({ t: token }),
  });
  if (!r.ok) throw new Error(await parseApiError(r));
  return r.json() as Promise<{ message: string }>;
}
