import { usernameColor } from './chat';

/** Two-letter initials from a display name (same idea as chat avatars). */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase().replace(/[^A-Z0-9]/g, '') || '?';
}

/** Tailwind classes for skill badge (1–5 scale used by the app). */
export function skillBadgeClasses(score: number): string {
  const s = Math.round(score);
  if (s <= 2) {
    return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-200';
  }
  if (s === 3) {
    return 'bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-200';
  }
  if (s >= 4) {
    return 'bg-rose-100 text-rose-900 dark:bg-rose-950/80 dark:text-rose-200';
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
}

export function playerAvatarColor(name: string): string {
  return usernameColor(name);
}
