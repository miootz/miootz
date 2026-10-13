/**
 * Refcounted hub over the ONE session-data SSE channel
 * (`GET /sessions/{id}/data/events`, see api/sessionsApi.sessionDataEventsUrl).
 *
 * Every surface that cares about a session's live data (PlayerApp roster,
 * LiveMatchBanner scoreboard/goals, RefereePage console) subscribes here
 * instead of opening its own EventSource: for a given sessionId there is at
 * most ONE physical connection shared by all handlers, and it is closed when
 * the last subscriber unmounts.
 *
 * Handlers receive parsed messages. Connection liveness is pushed through the
 * optional onLiveChange callback (mirrors the old per-page
 * `es.onopen/onerror → setRosterChannelLive` plumbing). On a gap the next
 * snapshot refetch heals state — we never replay missed events here; callers
 * refetch by id when they receive an event or when the link comes back.
 */
import { sessionDataEventsUrl } from "../api/sessionsApi";

export type SessionDataMessage = Record<string, unknown>;
export type SessionDataHandler = (data: SessionDataMessage) => void;
export type SessionLiveHandler = (live: boolean) => void;

interface Channel {
  es: EventSource | null;
  token: string | undefined;
  live: boolean;
  messageHandlers: Set<SessionDataHandler>;
  liveHandlers: Set<SessionLiveHandler>;
  attached: boolean; // window online/offline listeners wired
}

const channels = new Map<number, Channel>();

function connect(ch: Channel, sessionId: number): void {
  if (ch.es) return;
  const es = new EventSource(sessionDataEventsUrl(sessionId, ch.token));
  ch.es = es;
  es.onopen = () => setLive(ch, true);
  es.onerror = () => setLive(ch, false);
  es.onmessage = (ev) => {
    let data: SessionDataMessage;
    try {
      data = JSON.parse(ev.data) as SessionDataMessage;
    } catch {
      console.error("SSE: ignoring malformed message");
      return;
    }
    for (const handler of [...ch.messageHandlers]) {
      try {
        handler(data);
      } catch {
        // One misbehaving handler must not starve the others.
      }
    }
  };
}

function setLive(ch: Channel, live: boolean): void {
  if (ch.live === live) return;
  ch.live = live;
  for (const handler of [...ch.liveHandlers]) {
    try {
      handler(live);
    } catch {
      // ignore
    }
  }
}

function forceReconnect(ch: Channel, sessionId: number): void {
  // EventSource does not always recover after the network flaps (e.g.
  // DevTools Offline Mode); when the browser comes back, rebuild the link.
  if (ch.es) {
    ch.es.close();
    ch.es = null;
  }
  setLive(ch, false);
  connect(ch, sessionId);
}

/**
 * Subscribe to the shared session-data feed. Returns an unsubscribe function.
 * `accessToken` may change (refresh); the hub reconnects with the new token
 * when the subscription is re-established.
 */
export function subscribeSessionData(
  sessionId: number,
  accessToken: string | undefined,
  onMessage: SessionDataHandler,
  onLiveChange?: SessionLiveHandler,
): () => void {
  if (!Number.isFinite(sessionId)) return () => {};

  let ch = channels.get(sessionId);
  if (!ch) {
    ch = {
      es: null,
      token: accessToken,
      live: false,
      messageHandlers: new Set(),
      liveHandlers: new Set(),
      attached: false,
    };
    channels.set(sessionId, ch);
  }

  const tokenChanged = ch.token !== accessToken;
  ch.token = accessToken;
  ch.messageHandlers.add(onMessage);
  if (onLiveChange) {
    ch.liveHandlers.add(onLiveChange);
    onLiveChange(ch.live);
  }

  if (tokenChanged) forceReconnect(ch, sessionId);
  else connect(ch, sessionId);

  if (!ch.attached) {
    ch.attached = true;
    const goOnline = () => forceReconnect(ch!, sessionId);
    window.addEventListener("online", goOnline);
    // Stashed on the channel so teardown can detach it (single listener).
    (ch as Channel & { _onlineCleanup?: () => void })._onlineCleanup =
      () => window.removeEventListener("online", goOnline);
  }

  return () => {
    ch!.messageHandlers.delete(onMessage);
    if (onLiveChange) ch!.liveHandlers.delete(onLiveChange);
    if (
      ch!.messageHandlers.size === 0 &&
      ch!.liveHandlers.size === 0
    ) {
      if (ch!.es) ch!.es.close();
      const cleanup = (ch as Channel & { _onlineCleanup?: () => void })._onlineCleanup;
      cleanup?.();
      channels.delete(sessionId);
    }
  };
}
