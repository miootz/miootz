import { usernameColor } from './chat';

/** Two-letter initials from a display name (same idea as chat avatars). */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase().replace(/[^A-Z0-9]/g, '') || '?';
}

/** Tailwind classes for skill badge — the number carries the level. */
export function skillBadgeClasses(_score: number): string {
  return "bg-raised text-ink-dim";
}

export function playerAvatarColor(name: string): string {
  return usernameColor(name);
}
