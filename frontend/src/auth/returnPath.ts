/** Consume only same-origin app paths saved before OIDC sign-in. */
export function consumeReturnPath(): string {
  const path = sessionStorage.getItem('miootz_return_path');
  sessionStorage.removeItem('miootz_return_path');
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/';
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || url.pathname === '/auth/callback') return '/';
  return url.pathname + url.search + url.hash;
}
