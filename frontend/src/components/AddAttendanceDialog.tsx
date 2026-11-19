import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { adminAddAttendance, adminListUsers, type AdminUserRow } from "../api/adminApi";
import type { MeetupDetail } from "../api/meetupsApi";
import { hapticLight } from "../utils/haptics";
import { PlayerAvatarFace } from "./PlayerAvatar";

const PAGE_SIZE = 25;

export function AddAttendanceDialog({
  meetupId,
  attendees,
  onChanged,
  onClose,
}: {
  meetupId: number;
  attendees: MeetupDetail["attendees"];
  onChanged: () => void | Promise<void>;
  onClose: () => void;
}) {
  const titleId = useId();
  const searchId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [players, setPlayers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [added, setAdded] = useState<Record<number, string>>({});

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    searchRef.current?.focus();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const page = await adminListUsers({ q: search.trim() || undefined, limit: PAGE_SIZE, offset });
        if (!cancelled) {
          setPlayers((current) => offset ? [...current, ...page.items] : page.items);
          setTotal(page.total);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Could not load players.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, search ? 200 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, offset, attempt]);

  async function addPlayer(player: AdminUserRow) {
    const name = player.display_name || player.username || `Player ${player.id}`;
    setSaving(player.id);
    setActionError(null);
    setNotice("");
    try {
      const { status } = await adminAddAttendance(meetupId, player.id);
      setAdded((current) => ({ ...current, [player.id]: status }));
      setNotice(`${name} added as ${status}.`);
      hapticLight();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not add player.");
    }
    try {
      await onChanged();
    } catch {
      setActionError((current) => `${current ? `${current} ` : ""}Could not refresh attendance.`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={onClose}
      className="fixed inset-x-0 top-auto bottom-4 mx-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto overscroll-contain border border-line bg-panel p-0 text-ink shadow-xl backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/50 sm:inset-0 sm:m-auto"
    >
      <div className="p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-bold text-ink">Add player</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center text-ink-dim hover:bg-raised hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div role="search" className="mt-4 block">
          <label htmlFor={searchId} className="text-sm font-medium text-ink">Search players</label>
          <div className="mt-1 flex items-center gap-2 border border-line bg-raised px-3 focus-within:outline focus-within:outline-2 focus-within:outline-live">
            <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            <input
              id={searchId}
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
                setPlayers([]);
                setTotal(0);
                setLoadError(null);
                setLoading(true);
              }}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Name or username"
              className="min-h-11 min-w-0 flex-1 bg-transparent text-base placeholder:text-ink-faint focus:outline-hidden focus-visible:shadow-none"
            />
          </div>
        </div>

        {notice && <p role="status" className="mt-3 text-sm text-ink">{notice}</p>}
        {actionError && <p role="alert" className="mt-3 text-sm text-danger">{actionError}</p>}
        <ul role="list" className="mt-4 space-y-2">
          {players.map((player) => {
            const name = player.display_name || player.username || `Player ${player.id}`;
            const status = attendees.find((attendee) => attendee.user_id === player.id)?.status ?? added[player.id];
            return (
              <li key={player.id} className="flex flex-wrap items-center gap-2 border border-line bg-panel p-3">
                <PlayerAvatarFace name={name} avatarUrl={player.avatar_url ?? undefined} size="sm" />
                <span className="min-w-[8rem] flex-1 break-words text-sm font-medium">{name}</span>
                {status ? (
                  <span className="text-sm text-ink-dim">{status.charAt(0).toUpperCase() + status.slice(1)}</span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Add ${name}`}
                    disabled={saving !== null}
                    onClick={() => void addPlayer(player)}
                    className="min-h-11 shrink-0 border border-live/40 bg-live/15 px-3 text-xs font-medium text-live hover:bg-live/25 disabled:opacity-50"
                  >Add</button>
                )}
              </li>
            );
          })}
        </ul>
        {loading && <p className="py-4 text-center text-sm text-ink-dim">Loading players…</p>}
        {!loading && !loadError && players.length === 0 && (
          <p className="py-4 text-center text-sm text-ink-dim">No matching players.</p>
        )}
        {loadError && (
          <div className="mt-3 text-center">
            <p role="alert" className="text-sm text-danger">{loadError}</p>
            <button type="button" onClick={() => { setLoading(true); setLoadError(null); setAttempt((n) => n + 1); }} className="min-h-11 px-3 text-sm text-live underline">Retry</button>
          </div>
        )}
        {!loading && !loadError && players.length < total && (
          <button type="button" onClick={() => { setLoading(true); setOffset(players.length); }} className="mt-3 min-h-11 w-full border border-line text-sm font-medium text-ink hover:bg-raised">Load more</button>
        )}
      </div>
    </dialog>
  );
}
