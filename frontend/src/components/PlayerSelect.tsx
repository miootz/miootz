import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Avatar } from "./Avatar";

export interface SelectablePlayer {
  id: number;
  name: string;
  avatarUrl?: string | null;
  /** "A" | "B" tag shown next to the name so two teams are distinguishable. */
  teamTag?: string;
}

interface PlayerSelectProps {
  label: string;
  /** Players offered in the dropdown (already filtered by the caller). */
  players: SelectablePlayer[];
  selected: SelectablePlayer | null;
  onSelect: (player: SelectablePlayer) => void;
  placeholder?: string;
  /** Offered under the search box so an accidental pick can be undone. */
  allowClear?: boolean;
  onClear?: () => void;
  disabled?: boolean;
}

/**
 * Searchable player dropdown (plan §6): profile pic + name per option.
 *
 * Collapsed = search input with a chevron. Expanded = filter list of the
 * roster with avatar tiles; picking one collapses the list with the choice
 * shown in the trigger row (avatar + name), so the form stays compact on a
 * phone held at arm's length on the sideline.
 */
export function PlayerSelect({
  label,
  players,
  selected,
  onSelect,
  placeholder = "Search player…",
  allowClear = false,
  onClear,
  disabled = false,
}: PlayerSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Click-outside closes the list.
  useEffect(() => {
    if (!open) return;
    const onOutsideClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("click", onOutsideClick);
    return () => document.removeEventListener("click", onOutsideClick);
  }, [open]);

  const filtered = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return players;
    return players.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        (p.teamTag ?? "").toLowerCase().includes(s),
    );
  }, [players, query]);

  // Keep the picked player visible even when a query hides it.
  const shown = useMemo(() => {
    if (open && selected && !filtered.some((p) => p.id === selected.id)) {
      return [selected, ...filtered];
    }
    return filtered;
  }, [open, selected, filtered]);

  return (
    <div ref={rootRef} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
        setOpen(false);
        setQuery("");
      }
    }}>
      <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim mb-1.5">
        {label}
      </p>

      {/* Trigger: search input; keeps the chosen name after collapse. */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => {
            setOpen(!open);
            setQuery("");
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-faint hover:text-ink"
          aria-label={open ? "Close list" : "Open list"}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        <input
          value={open ? query : selected?.name ?? ""}
          onChange={(e) => {
            if (!open) setOpen(true);
            setQuery(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2.5 border border-line bg-raised text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live disabled:opacity-50"
          aria-label={label}
        />
      </div>

      {/* The sheet scrolls through the options as part of the form. */}
      {open && (
        <div id={listId} className="mt-1 border border-line bg-panel">
          {shown.length === 0 ? (
            <p className="p-3 text-xs text-ink-faint">No players found.</p>
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((p) => {
                const isSel = selected?.id === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(p);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={`w-full flex min-h-12 items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                        isSel
                          ? "bg-live/15 text-live font-semibold"
                          : "hover:bg-raised text-ink"
                      }`}
                    >
                      <Avatar url={p.avatarUrl} username={p.name} size="md" />
                      <span className="truncate flex-1">{p.name}</span>
                      {p.teamTag && (
                        <span className="text-xs text-ink-faint shrink-0">
                          {p.teamTag}
                        </span>
                      )}
                      {isSel && (
                        <Check className="h-4 w-4 text-live shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {allowClear && selected && (
            <div className="border-t border-line p-2">
              <button
                type="button"
                onClick={() => {
                  onClear?.();
                  setOpen(false);
                  setQuery("");
                }}
                className="min-h-12 w-full text-center text-sm text-ink-dim hover:text-ink"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
