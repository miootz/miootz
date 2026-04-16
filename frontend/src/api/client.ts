/** Base path for API (same-origin /api in production / Traefik). */
export function apiBase(): string {
  return (import.meta.env.VITE_API_BASE as string | undefined) || '/api';
}

export async function parseApiError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
      return d
        .map((x) =>
          typeof x === 'object' && x !== null && 'msg' in x
            ? String((x as { msg: string }).msg)
            : String(x)
        )
        .join(', ');
    }
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`;
}

export async function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${apiBase()}${path.startsWith('/') ? '' : '/'}${path}`;
  return fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init?.body && typeof init.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });
}
