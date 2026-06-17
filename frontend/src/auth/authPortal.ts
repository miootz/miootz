import { getPocketIdUrl } from './pocketIdOidc';

/** Pocket ID base URL. */
export function getAuthPortalBase(): string {
  return getPocketIdUrl();
}

/** Pocket ID URL with trailing slash (legacy callers). */
export function getAuthPortalUrl(): string {
  return `${getAuthPortalBase()}/`;
}

/**
 * Redirect to Pocket ID login.
 * @deprecated Use `authorize()` from pocketIdOidc.ts instead.
 */
export function getAuthLoginUrl(_returnTo: string): string {
  return getAuthPortalBase();
}
