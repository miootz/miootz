import { demoRoom, roomStorageKey } from '../utils/demoRoom';

/** Consume only same-origin app paths saved before OIDC sign-in. */
export function consumeReturnPath(): string {
  const key = roomStorageKey('miootz_return_path');
  const path = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/';
  const url = new URL(path, window.location.origin);
  const room = demoRoom();
  if (url.origin !== window.location.origin || (room && url.pathname !== room && !url.pathname.startsWith(`${room}/`))) return '/';
  const pathname = room ? url.pathname.slice(room.length) || '/' : url.pathname;
  if (pathname === '/auth/callback') return '/';
  return pathname + url.search + url.hash;
}
