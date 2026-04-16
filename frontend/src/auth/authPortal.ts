/**
 * Authelia portal base URL. Override with `VITE_AUTH_URL` if hostname heuristics don't apply.
 */
export function getAuthPortalBase(): string {
  const fromEnv = import.meta.env.VITE_AUTH_URL as string | undefined;
  if (fromEnv?.trim()) {
    return fromEnv.replace(/\/+$/, '');
  }
  const { protocol, hostname, port } = window.location;
  if (hostname.startsWith('app.')) {
    const host = `auth.${hostname.slice(4)}`;
    const p = port ? `:${port}` : '';
    return `${protocol}//${host}${p}`;
  }
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
}

/** Portal root with trailing slash (legacy callers). */
export function getAuthPortalUrl(): string {
  return `${getAuthPortalBase()}/`;
}

/**
 * Authelia login URL with post-login redirect (`rd` must be URL-encoded).
 * @see https://www.authelia.com/integration/proxies/traefik/
 */
export function getAuthLoginUrl(returnTo: string): string {
  const base = getAuthPortalBase();
  const rd = encodeURIComponent(returnTo);
  return `${base}/?rd=${rd}`;
}
