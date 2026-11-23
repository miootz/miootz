/**
 * Refcounted hub over the ONE meetup-data SSE channel
 * (`GET /meetups/{id}/data/events`, see api/meetupsApi.meetupDataEventsUrl).
 *
 * Every surface that cares about a meetup's live data (PlayerApp roster,
 * LiveMatchBanner scoreboard/goals, RefereePage console) subscribes here
 * instead of opening its own EventSource: for a given meetupId there is at
 * most ONE physical connection shared by all handlers, and it is closed when
 * the last subscriber unmounts.
 *
 * Handlers receive parsed messages. Connection liveness is pushed through the
 * optional onLiveChange callback (mirrors the old per-page
 * `es.onopen/onerror → setRosterChannelLive` plumbing). On a gap the next
 * snapshot refetch heals state — we never replay missed events here; callers
 * refetch when they receive an event or when the link comes back. The separate
 * meetup-list channel uses the same hub for overviews with no active meetup.
 */
import { meetupDataEventsUrl, meetupListEventsUrl } from "../api/meetupsApi";

export type MeetupDataMessage = Record<string, unknown>;
export type MeetupDataHandler = (data: MeetupDataMessage) => void;
export type MeetupLiveHandler = (live: boolean) => void;

interface Channel {
  es: EventSource | null;
  token: string | undefined;
  live: boolean;
  messageHandlers: Set<MeetupDataHandler>;
  liveHandlers: Set<MeetupLiveHandler>;
  attached: boolean; // window online/offline listeners wired
}

const channels = new Map<number | null, Channel>();

function connect(ch: Channel, meetupId: number | null): void {
  if (ch.es) return;
  const url = meetupId === null
    ? meetupListEventsUrl(ch.token)
    : meetupDataEventsUrl(meetupId, ch.token);
  const es = new EventSource(url);
  ch.es = es;
  es.onopen = () => setLive(ch, true);
  es.onerror = () => setLive(ch, false);
  es.onmessage = (ev) => {
    let data: MeetupDataMessage;
    try {
      data = JSON.parse(ev.data) as MeetupDataMessage;
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

function forceReconnect(ch: Channel, meetupId: number | null): void {
  // EventSource does not always recover after the network flaps (e.g.
  // DevTools Offline Mode); when the browser comes back, rebuild the link.
  if (ch.es) {
    ch.es.close();
    ch.es = null;
  }
  setLive(ch, false);
  connect(ch, meetupId);
}

/**
 * Subscribe to the shared meetup-data feed. Returns an unsubscribe function.
 * `accessToken` may change (refresh); the hub reconnects with the new token
 * when the subscription is re-established.
 */
export function subscribeMeetupData(
  meetupId: number,
  accessToken: string | undefined,
  onMessage: MeetupDataHandler,
  onLiveChange?: MeetupLiveHandler,
): () => void {
  if (!Number.isFinite(meetupId)) return () => {};
  return subscribe(meetupId, accessToken, onMessage, onLiveChange);
}

export function subscribeMeetupList(
  accessToken: string | undefined,
  onMessage: MeetupDataHandler,
  onLiveChange?: MeetupLiveHandler,
): () => void {
  return subscribe(null, accessToken, onMessage, onLiveChange);
}

function subscribe(
  meetupId: number | null,
  accessToken: string | undefined,
  onMessage: MeetupDataHandler,
  onLiveChange?: MeetupLiveHandler,
): () => void {
  let ch = channels.get(meetupId);
  if (!ch) {
    ch = {
      es: null,
      token: accessToken,
      live: false,
      messageHandlers: new Set(),
      liveHandlers: new Set(),
      attached: false,
    };
    channels.set(meetupId, ch);
  }

  const tokenChanged = ch.token !== accessToken;
  ch.token = accessToken;
  ch.messageHandlers.add(onMessage);
  if (onLiveChange) {
    ch.liveHandlers.add(onLiveChange);
    onLiveChange(ch.live);
  }

  if (tokenChanged) forceReconnect(ch, meetupId);
  else connect(ch, meetupId);

  if (!ch.attached) {
    ch.attached = true;
    const goOnline = () => forceReconnect(ch!, meetupId);
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
      channels.delete(meetupId);
    }
  };
}
