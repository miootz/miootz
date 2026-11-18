import { roomStorageKey } from '../utils/demoRoom';

const KEY = roomStorageKey('miootz_prefer_member_home');

/** When true, admins stay on the member (player) UI at `/` instead of defaulting to `/admin`. */
export function setPreferMemberView(prefer: boolean): void {
  if (prefer) sessionStorage.setItem(KEY, '1');
  else sessionStorage.removeItem(KEY);
}

export function getPreferMemberView(): boolean {
  return sessionStorage.getItem(KEY) === '1';
}
