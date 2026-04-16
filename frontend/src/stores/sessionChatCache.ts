import type { ChatMessage } from '../types';

/** Session-scoped cache (tab session). Full reload always refetches meetup data from the API. */
const STORAGE_KEY = 'footy:sessionChatCache';
const VERSION = 3 as const;

type Stored = {
  v: typeof VERSION;
  chatBySessionId: Record<string, ChatMessage[]>;
};

const empty = (): Stored => ({ v: VERSION, chatBySessionId: {} });

function read(): Stored {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed.v !== VERSION) return empty();
    return {
      ...empty(),
      ...parsed,
      chatBySessionId:
        parsed.chatBySessionId && typeof parsed.chatBySessionId === 'object'
          ? parsed.chatBySessionId
          : {},
    };
  } catch {
    return empty();
  }
}

function write(data: Stored): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

/** Clears chat entries in sessionStorage (e.g. when the active meetup is deleted). */
export function clearSessionChatCache(): void {
  write(empty());
}

/** `undefined` = never cached; array (possibly empty) = known state from a prior load. */
export function getCachedChatMessages(
  sessionId: string
): ChatMessage[] | undefined {
  const s = read();
  if (!Object.prototype.hasOwnProperty.call(s.chatBySessionId, sessionId)) {
    return undefined;
  }
  return s.chatBySessionId[sessionId];
}

export function setCachedChatMessages(
  sessionId: string,
  messages: ChatMessage[]
): void {
  const s = read();
  write({
    ...s,
    chatBySessionId: { ...s.chatBySessionId, [sessionId]: messages },
  });
}

export function appendCachedChatMessage(
  sessionId: string,
  message: ChatMessage
): void {
  const s = read();
  const prev = s.chatBySessionId[sessionId] ?? [];
  if (prev.some((m) => m.id === message.id)) {
    return;
  }
  write({
    ...s,
    chatBySessionId: {
      ...s.chatBySessionId,
      [sessionId]: [...prev, message],
    },
  });
}
