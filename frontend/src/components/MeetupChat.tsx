import { parseMeetupStart } from "../utils/datetime";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import type { ChatMessage } from "../types";
import {
  groupMessages,
  formatDateHeader,
  formatCompactTime,
  usernameColor,
  type ChatMessageGroup,
} from "../utils/chat";
import { apiFetch } from "../api/client";
import { mediaUrl } from "../api/meApi";
import {
  postMeetupChatTyping,
  meetupChatEventsUrl,
} from "../api/meetupsApi";
import { useAuth } from "../auth/useAuth";
import {
  appendCachedChatMessage,
  getCachedChatMessages,
  setCachedChatMessages,
} from "../stores/meetupChatCache";
import { useToast } from "../context/ToastContext";
import {
  enqueueOutbox,
  processOutbox,
  requestBackgroundSync,
} from "../offline/outbox";
import {
  ArrowDown,
  ChevronDown,
  Send,
  Smile,
  X,
} from "lucide-react";
import { hapticLight } from "../utils/haptics";
import { roomStorageKey } from "../utils/demoRoom";

const chatLastReadKey = (meetupId: string) =>
  roomStorageKey(`miootz:chat:lastRead:${meetupId}`);
const CHAT_PREVIEW_LIMIT = 4;
const CHAT_PREVIEW_FADE =
  "linear-gradient(to bottom, black calc(100% - 1.5rem), transparent)";

const QUICK_EMOJIS = [
  "⚽",
  "👍",
  "🔥",
  "😂",
  "❤️",
  "🎉",
  "👏",
  "🙌",
  "😀",
  "🙏",
  "💪",
  "✅",
  "⚡",
  "🏃",
  "☀️",
] as const;

const MAX_MESSAGE_LENGTH = 1000;

interface MeetupChatProps {
  meetupId: string;
  /** Member view collapses by default; management surfaces pass true. */
  defaultExpanded?: boolean;
  /** Fill the parent column's height on desktop/tablet (admin Overview). */
  fillHeight?: boolean;
}

/** ─── Avatar / initials ─────────────────────────────────────────── */
function Avatar({
  url,
  username,
  size = "sm",
}: {
  url?: string | null;
  username: string;
  size?: "sm" | "md";
}) {
  const sizeClasses = size === "md" ? "w-9 h-9 text-sm" : "w-7 h-7 text-xs";

  const resolved = mediaUrl(url ?? undefined);
  if (resolved) {
    return (
      <img
        src={resolved}
        alt=""
        className={`${sizeClasses} border border-line object-cover flex-shrink-0`}
        loading="lazy"
      />
    );
  }

  const initials = username
    .slice(0, 2)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  return (
    <div
      className={`${sizeClasses} border border-line bg-raised text-ink font-medium flex items-center justify-center flex-shrink-0 select-none`}
    >
      {initials}
    </div>
  );
}

/** ─── Skeleton loader ───────────────────────────────────────────── */
function ChatSkeleton() {
  const pulse =
    "motion-safe:animate-pulse motion-reduce:animate-none bg-raised";
  const bubbleHeights = ["h-12", "h-8", "h-10", "h-8", "h-12"] as const;

  return (
    <div className="space-y-6 px-4 pt-4" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => {
        const mine = i % 3 === 1;
        return (
          <div
            key={i}
            className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}
          >
            <div className={`h-7 w-7 flex-shrink-0 ${pulse}`} />
            <div
              className={`flex-1 space-y-2 ${mine ? "flex flex-col items-end" : ""}`}
            >
              <div
                className={`h-3 w-20 ${mine ? "ml-auto" : ""} ${pulse}`}
              />
              <div
                className={`w-full max-w-[14rem] ${bubbleHeights[i]} ${pulse} ${
                  mine ? "ml-auto" : ""
                }`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** ─── Message group ─────────────────────────────────────────────── */
function MessageGroup({ group }: { group: ChatMessageGroup }) {
  const isFirst = group.showHeader;
  const mine = group.isMine;

  const bubbleMine = "bg-raised text-ink";
  const bubbleOther = "bg-panel border border-line text-ink";

  return (
    <div className={`flex gap-2 group/chat ${mine ? "flex-row-reverse" : ""}`}>
      {/* Avatar column */}
      <div className="w-7 flex-shrink-0 pt-1">
        {isFirst && <Avatar url={group.avatarUrl} username={group.username} />}
      </div>

      {/* Messages column */}
      <div
        className={`flex-1 min-w-0 flex flex-col ${mine ? "items-end" : "items-start"}`}
      >
        {/* Username + timestamp */}
        {isFirst && (
          <div
            className={`flex items-baseline gap-2 mb-1 px-1 max-w-[85%] ${
              mine ? "flex-row-reverse justify-end" : ""
            }`}
          >
            <span
              className="text-xs font-semibold truncate text-ink"
              style={mine ? undefined : { color: group.usernameColor }}
            >
              {mine ? "You" : group.username}
            </span>
            <span className="text-2xs text-ink-faint tabular-nums shrink-0">
              {formatCompactTime(group.messages[0].time)}
            </span>
          </div>
        )}

        {/* Bubble(s) */}
        {group.messages.length === 1 ? (
          <div className="inline-block max-w-[85%]">
            <div
              className={`px-3 py-2 text-sm leading-relaxed break-words text-left ${
                mine ? bubbleMine : bubbleOther
              }`}
            >
              {group.messages[0].text}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden max-w-[85%]">
            {group.messages.map((m) => (
              <div
                key={m.id}
                className={`px-3 py-1.5 text-sm leading-relaxed break-words text-left ${
                  mine ? bubbleMine : bubbleOther
                }`}
              >
                {m.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** ─── Date separator ────────────────────────────────────────────── */
function DateSeparator({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 h-px bg-line" />
      <span className="text-2xs font-medium text-ink-faint uppercase tracking-wider">
        {formatDateHeader(date)}
      </span>
      <div className="flex-1 h-px bg-line" />
    </div>
  );
}

/** ─── Scroll-to-bottom FAB ──────────────────────────────────────── */
function ScrollToBottomFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-20 right-4 z-10 w-9 h-9 border border-line bg-panel shadow-lg flex items-center justify-center text-ink-dim hover:text-ink hover:shadow-xl transition-all"
      aria-label="Scroll to latest messages"
    >
      <ArrowDown className="w-4 h-4" />
    </button>
  );
}

/** ─── Main component ────────────────────────────────────────────── */
export const MeetupChat: React.FC<MeetupChatProps> = ({
  meetupId,
  defaultExpanded = false,
  fillHeight = false,
}) => {
  const { showToast } = useToast();
  const { me, tokens } = useAuth();
  const myUserId = me?.user.id ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  // Mobile renders the expanded chat as a full-screen overlay; start
  // collapsed there so it never obscures the page on first paint.
  const [isExpanded, setIsExpanded] = useState(
    () =>
      defaultExpanded &&
      !window.matchMedia("(max-width: 767px)").matches,
  );
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [previewClipped, setPreviewClipped] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  const previewContentRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef(0);
  const hasUserScrolledRef = useRef(false);
  const typingClearTimeoutsRef = useRef<
    Map<number, ReturnType<typeof setTimeout>>
  >(new Map());
  const [typingByUser, setTypingByUser] = useState<Record<number, string>>({});

  useEffect(() => {
    const preview = previewRef.current;
    const content = previewContentRef.current;
    if (!preview || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setPreviewClipped(preview.scrollHeight > preview.clientHeight);
    });
    observer.observe(preview);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const typingLabel = useMemo(() => {
    const names = Object.values(typingByUser);
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return `${names.length} people are typing…`;
  }, [typingByUser]);

  const handleTypingEvent = useCallback(
    (data: { user_id: number; username: string; typing: boolean }) => {
      if (myUserId != null && data.user_id === myUserId) return;
      const uid = data.user_id;
      const prevTimer = typingClearTimeoutsRef.current.get(uid);
      if (prevTimer) clearTimeout(prevTimer);
      if (data.typing) {
        setTypingByUser((prev) => ({ ...prev, [uid]: data.username }));
        typingClearTimeoutsRef.current.set(
          uid,
          setTimeout(() => {
            setTypingByUser((p) => {
              const n = { ...p };
              delete n[uid];
              return n;
            });
            typingClearTimeoutsRef.current.delete(uid);
          }, 3000),
        );
      } else {
        setTypingByUser((prev) => {
          const n = { ...prev };
          delete n[uid];
          return n;
        });
        typingClearTimeoutsRef.current.delete(uid);
      }
    },
    [myUserId],
  );

  useEffect(() => {
    const timers = typingClearTimeoutsRef;
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    };
  }, []);

  const flushTypingFalse = useCallback(() => {
    void postMeetupChatTyping(meetupId, false).catch(() => {});
  }, [meetupId]);

  const onMessageInputChange = (v: string) => {
    setNewMessage(v);
    setSendError(null);
    if (!v.trim()) {
      flushTypingFalse();
      return;
    }
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = now;
      void postMeetupChatTyping(meetupId, true).catch(() => {});
    }
  };

  /** Whether the user has scrolled up (away from bottom). */
  const userScrolledUp = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return true;
    if (!hasUserScrolledRef.current) return false;
    return el.scrollTop < el.scrollHeight - el.clientHeight - 80;
  }, []);

  /** Auto-scroll only when user is at or near bottom. */
  const scrollToBottom = useCallback(
    (force = false) => {
      const el = chatContainerRef.current;
      if (!el) return;
      if (force || !userScrolledUp()) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    },
    [userScrolledUp],
  );

  // Auto-scroll on new messages
  useEffect(() => {
    if (!isLoading) scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    if (!emojiOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (emojiWrapRef.current?.contains(e.target as Node)) return;
      setEmojiOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [emojiOpen]);

  // Track scroll position for FAB
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      hasUserScrolledRef.current = true;
      setShowScrollFab(userScrolledUp());
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [userScrolledUp]);

  // Mobile expanded chat is a full-screen overlay: lock page scroll behind
  // it (same pattern as the admin drawer) so gestures stay in the chat.
  useEffect(() => {
    if (!isExpanded || !window.matchMedia("(max-width: 767px)").matches) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isExpanded]);

  // Unread indicator for bottom nav (Details tab dot)
  useEffect(() => {
    if (messages.length === 0) return;
    const latestId = Math.max(...messages.map((m) => m.id));
    const key = chatLastReadKey(meetupId);
    const raw = localStorage.getItem(key);
    if (raw === null) {
      localStorage.setItem(key, String(latestId));
      window.dispatchEvent(
        new CustomEvent("miootz-chat-unread", {
          detail: { meetupId, unread: false },
        }),
      );
      return;
    }
    if (isExpanded) {
      localStorage.setItem(key, String(latestId));
      window.dispatchEvent(
        new CustomEvent("miootz-chat-unread", {
          detail: { meetupId, unread: false },
        }),
      );
      return;
    }
    const lastRead = Number(raw) || 0;
    const unread = latestId > lastRead;
    window.dispatchEvent(
      new CustomEvent("miootz-chat-unread", {
        detail: { meetupId, unread },
      }),
    );
  }, [messages, meetupId, isExpanded]);

  // Reset state when meetupId changes (hydrate from IndexedDB)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fromStore = await getCachedChatMessages(meetupId);
      if (cancelled) return;
      setMessages(fromStore ?? []);
      setIsLoading(fromStore === undefined);
      setShowScrollFab(false);
      setSendError(null);
      hasUserScrolledRef.current = false;
    })();
    return () => {
      cancelled = true;
    };
  }, [meetupId]);

  // SSE + initial fetch
  useEffect(() => {
    let cancelled = false;
    const eventSource = new EventSource(
      meetupChatEventsUrl(meetupId, tokens?.accessToken),
    );

    eventSource.onmessage = (event) => {
      let raw: {
        type?: string;
        user_id?: number;
        username?: string;
        typing?: boolean;
        id?: number;
      };
      try {
        raw = JSON.parse(event.data);
      } catch {
        console.error("SSE: ignoring malformed message");
        return;
      }
      if (raw.type === "typing") {
        if (raw.user_id != null && raw.username != null) {
          handleTypingEvent({
            user_id: raw.user_id,
            username: raw.username,
            typing: raw.typing !== false,
          });
        }
        return;
      }
      const msg = raw as ChatMessage;
      if (msg.id == null) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        void appendCachedChatMessage(meetupId, msg);
        return [...prev, msg];
      });
    };

    eventSource.onerror = (error) => {
      console.error("SSE Error:", error);
      eventSource.close();
    };

    (async () => {
      const cached = await getCachedChatMessages(meetupId);
      if (cached !== undefined) {
        if (!cancelled) setIsLoading(false);
        return;
      }
      try {
        const response = await apiFetch(`/meetups/${meetupId}/chat`);
        if (cancelled) return;
        if (response.ok) {
          const data = (await response.json()) as ChatMessage[];
          setMessages(data);
          await setCachedChatMessages(meetupId, data);
        } else {
          await setCachedChatMessages(meetupId, []);
        }
      } catch (error) {
        console.error("Failed to fetch initial messages:", error);
        const fallback = await getCachedChatMessages(meetupId);
        if (!cancelled && fallback !== undefined) {
          setMessages(fallback);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      eventSource.close();
    };
  }, [meetupId, handleTypingEvent, tokens?.accessToken]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newMessage.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) return;

    setSendError(null);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      try {
        await enqueueOutbox({
          type: "chat",
          meetupId,
          message: trimmed,
        });
        await requestBackgroundSync();
        setNewMessage("");
        flushTypingFalse();
        hapticLight();
        showToast(
          "Message queued — will send when you’re back online.",
          "success",
        );
      } catch (err) {
        console.error(err);
        setSendError("Could not queue message");
      }
      return;
    }

    try {
      const response = await apiFetch(`/meetups/${meetupId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: trimmed }),
      });

      if (response.ok) {
        setNewMessage("");
        flushTypingFalse();
        hapticLight();
        void processOutbox();
      } else {
        const errBody = await response.text();
        setSendError(errBody || "Failed to send message");
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      setSendError("Network error — check your connection");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  // Build grouped messages with date separators
  const flatMessages: Array<{
    id: number;
    userId: number;
    username: string;
    usernameColor: string;
    avatarUrl: string | null;
    text: string;
    time: Date;
  }> = messages.map((m) => {
    const mine = myUserId != null && m.user_id === myUserId;
    // SAFETY: /me `user` is loose backend JSON; profile_pic is an optional
    // avatar path not yet reflected in the MeResponse TS type. Both reads
    // null-check before use, so a missing key is safe.
    const meUser = me as unknown as Record<string, unknown> | null;
    const cropped =
      mine &&
      me != null &&
      (meUser as Record<string, unknown>)?.profile_pic != null
        ? String((meUser as Record<string, unknown>).profile_pic)
        : m.avatar_url;
    return {
      id: m.id,
      userId: m.user_id,
      username: m.username,
      usernameColor: m.username_color ?? usernameColor(m.username),
      avatarUrl: cropped ?? null,
      text: m.message,
      time: parseMeetupStart(m.created_at),
    };
  });

  const groups = groupMessages(flatMessages, myUserId);

  // Interleave date separators
  const rendered: React.ReactNode[] = [];
  let lastDateStr = "";
  for (const group of groups) {
    const dateStr = formatDateHeader(group.messages[0].time);
    if (dateStr !== lastDateStr) {
      rendered.push(
        <DateSeparator
          key={`date-${group.messages[0].id}`}
          date={group.messages[0].time}
        />,
      );
      lastDateStr = dateStr;
    }
    rendered.push(
      <MessageGroup key={`group-${group.messages[0].id}`} group={group} />,
    );
  }

  const messageCount = messages.length;
  const fadePreview =
    !isLoading && (messageCount > CHAT_PREVIEW_LIMIT || previewClipped);
  const charCount = newMessage.trim().length;
  const isOverLimit = charCount > MAX_MESSAGE_LENGTH;

  // ─── Inline view ──────────────────────────────────────────────
  // Mobile: collapsed preview that opens as a full-screen overlay. On md+
  // the live chat is always shown inline and the preview is hidden.
  return (
    <>
      <section
        aria-label="Chat preview"
        className={`max-w-2xl mx-auto w-full md:hidden ${isExpanded ? "hidden" : ""}`}
      >
        <div className="bg-panel border border-line">
          <div
            ref={previewRef}
            className="max-h-[190px] overflow-hidden"
            style={fadePreview ? {
              maskImage: CHAT_PREVIEW_FADE,
              WebkitMaskImage: CHAT_PREVIEW_FADE,
            } : undefined}
          >
            <div ref={previewContentRef} className="space-y-3 px-4 py-3">
              {isLoading ? (
                <p className="text-center text-sm text-ink-faint">Loading…</p>
              ) : flatMessages.length === 0 ? (
                <p className="text-center text-sm text-ink-faint">No messages yet</p>
              ) : (
                flatMessages.slice(-CHAT_PREVIEW_LIMIT).map((m) => (
                  <div key={m.id} className="flex gap-2">
                    <Avatar url={m.avatarUrl} username={m.username} />
                    <div className="min-w-0 max-w-[85%] border border-line bg-panel px-3 py-1.5 text-sm text-ink wrap-anywhere">
                      {m.text}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="mt-2 min-h-11 w-full border border-line bg-panel px-4 text-sm font-medium text-ink transition-colors hover:bg-raised"
        >
          Open chat
        </button>
      </section>

      {/* Expanded view: inline on md+, full-screen overlay on mobile. */}
      <section
        aria-label="Chat"
        className={`max-w-2xl mx-auto w-full ${
          fillHeight ? "h-full" : ""
        } ${isExpanded ? "max-md:block" : "hidden"} md:block ${
          isExpanded
            ? "max-md:fixed max-md:inset-0 max-md:z-[45] max-md:max-w-none max-md:p-2 max-md:bg-board/60"
            : ""
        }`}
      >
      <div
        className={`relative bg-panel border border-line overflow-hidden flex flex-col ${
          fillHeight ? "md:h-full" : "h-[min(75vh,600px)]"
        } ${isExpanded ? "max-md:h-[calc(100dvh-1rem)]" : ""}`}
      >
        <div className="flex shrink-0 justify-end border-b border-line px-2 md:hidden">
          <button
            type="button"
            onClick={() => {
              setIsExpanded(false);
              scrollToBottom(true);
            }}
            className="flex h-11 w-11 items-center justify-center text-ink-dim transition-colors hover:bg-raised"
            aria-label="Collapse chat"
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Messages */}
        <div
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4 relative"
        >
          {isLoading ? (
            <ChatSkeleton />
          ) : flatMessages.length === 0 ? (
            <p className="grid h-full place-items-center text-center text-sm text-ink-faint">
              No messages yet
            </p>
          ) : (
            rendered
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll-to-bottom FAB */}
        {showScrollFab && !isLoading && flatMessages.length > 0 && (
          <ScrollToBottomFab onClick={() => scrollToBottom(true)} />
        )}

        {typingLabel && (
          <div
            className="px-4 py-1.5 text-xs text-ink-faint bg-panel border-t border-line flex-shrink-0"
            aria-live="polite"
          >
            {typingLabel}
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={handleSendMessage}
          className="flex items-end gap-2 p-3 border-t border-line bg-panel flex-shrink-0"
        >
          <div className="relative shrink-0" ref={emojiWrapRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEmojiOpen((o) => !o);
              }}
              className="flex h-9 w-9 items-center justify-center border border-line text-ink-dim hover:bg-raised"
              aria-expanded={emojiOpen}
              aria-label="Insert emoji"
            >
              <Smile className="h-5 w-5" />
            </button>
            {emojiOpen && (
              <div
                className="absolute bottom-full left-0 z-20 mb-2 flex w-[13.5rem] flex-wrap gap-1 border border-line bg-panel p-2 shadow-lg"
                role="menu"
                aria-label="Quick emoji"
              >
                {QUICK_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    role="menuitem"
                    className="p-1.5 text-lg leading-none hover:bg-raised"
                    onClick={() => {
                      setNewMessage((m) =>
                        (m + em).slice(0, MAX_MESSAGE_LENGTH),
                      );
                      setEmojiOpen(false);
                      inputRef.current?.focus();
                    }}
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={newMessage}
            onChange={(e) => onMessageInputChange(e.target.value)}
            onBlur={() => flushTypingFalse()}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            maxLength={MAX_MESSAGE_LENGTH + 10}
            className="flex-1 min-w-0 px-3 py-2 border border-line bg-raised text-ink text-sm focus:outline-hidden focus:ring-2 focus:ring-live focus:border-transparent transition-shadow placeholder:text-ink-faint"
            aria-label="Chat message"
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || isOverLimit}
            className="flex-shrink-0 w-9 h-9 bg-ink text-board flex items-center justify-center hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors active:scale-95"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Footer info */}
        <div className="flex items-center justify-between px-4 py-1.5 text-2xs text-ink-faint border-t border-line bg-panel flex-shrink-0">
          <span className="tabular-nums">
            {messageCount} message{messageCount !== 1 ? "s" : ""}
          </span>
          <span className={`tabular-nums ${isOverLimit ? "text-danger font-medium" : ""}`}>
            {charCount}/{MAX_MESSAGE_LENGTH}
          </span>
        </div>

        {/* Send error toast */}
        {sendError && (
          <div className="absolute bottom-14 left-4 right-4 bg-danger/15 border border-danger/40 px-3 py-2 text-xs text-danger flex items-center justify-between gap-2 z-10">
            <span>{sendError}</span>
            <button
              type="button"
              onClick={() => setSendError(null)}
              className="flex-shrink-0 hover:text-white"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        </div>
      </section>
    </>
  );
};
