/** Deterministic pastel color from username — matches backend logic. */
export function usernameColor(username: string): string {
  const h = username.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) & 0xffffff;
  const r = (h >> 16) & 0xff;
  const g = (h >> 8) & 0xff;
  const b = h & 0xff;
  return `#${(r ^ 0x40).toString(16).padStart(2, '0')}${(g ^ 0x30).toString(16).padStart(2, '0')}${(b ^ 0x50).toString(16).padStart(2, '0')}`;
}

/** Group consecutive messages from the same user into clusters. */
export interface ChatMessageGroup {
  /** Shared username for the group. */
  username: string;
  /** Shared color for the group. */
  usernameColor: string;
  /** Shared avatar for the group. */
  avatarUrl: string | null;
  /** Messages in this group. */
  messages: Array<{
    id: number;
    text: string;
    time: Date;
  }>;
  /** Whether this group should show avatar/username (first group, or gap > 5 min). */
  showHeader: boolean;
  /** Whether this group should show the first message's avatar. */
  showAvatar: boolean;
}

export function groupMessages(
  messages: Array<{ id: number; username: string; usernameColor?: string | null; avatarUrl?: string | null; text: string; time: Date }>
): ChatMessageGroup[] {
  if (messages.length === 0) return [];

  const groups: ChatMessageGroup[] = [];
  let currentGroup: ChatMessageGroup | null = null;

  for (const msg of messages) {
    const showHeader =
      !currentGroup ||
      currentGroup.username !== msg.username ||
      msg.time.getTime() - currentGroup.messages[currentGroup.messages.length - 1].time.getTime() > 5 * 60 * 1000;

    if (showHeader && currentGroup) {
      groups.push(currentGroup);
    }

    if (showHeader) {
      currentGroup = {
        username: msg.username,
        usernameColor: msg.usernameColor ?? '',
        avatarUrl: msg.avatarUrl ?? null,
        messages: [{ id: msg.id, text: msg.text, time: msg.time }],
        showHeader: true,
        showAvatar: true,
      };
    } else if (currentGroup) {
      currentGroup.messages.push({ id: msg.id, text: msg.text, time: msg.time });
      currentGroup.showHeader = false;
      currentGroup.showAvatar = false;
    }
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

/** Truncate a date to "today", "yesterday", or the date string. */
export function formatDateHeader(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (today.getTime() - msgDay.getTime()) / (1000 * 60 * 60 * 24);

  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Compact time format: "14:30" or "14:30:05". */
export function formatCompactTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
