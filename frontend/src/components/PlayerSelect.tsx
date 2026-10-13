import { useEffect, useMemo, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Focus the search box whenever the list opens (so typing just works).
  useEffect(() => {
    if (open) {
      // The input inside the trigger is the same element; only re-focus if needed.
      if (document.activeElement !== inputRef.current) inputRef.current?.focus();
    }
  }, [open]);

  // Click-outside closes the list.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
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
    <div ref={rootRef} className="relative">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
        {label}
      </p>

      {/* Trigger: search input; keeps the chosen name after collapse. */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <ChevronDown
          className={`absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
        <input
          ref={inputRef}
          value={open ? query : selected?.name ?? ""}
          onChange={(e) => {
            if (!open) setOpen(true);
            setQuery(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50"
          aria-label={label}
        />
      </div>

      {/* Dropdown list (only while open) */}
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          {shown.length === 0 ? (
            <p className="p-3 text-xs text-gray-400">No players found.</p>
          ) : (
            <ul>
              {shown.map((p) => {
                const isSel = selected?.id === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      // mousedown so it beats the document click-outside handler.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(p);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                        isSel
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 font-semibold"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      <Avatar url={p.avatarUrl} username={p.name} size="md" />
                      <span className="truncate flex-1">{p.name}</span>
                      {p.teamTag && (
                        <span className="text-xs text-gray-400 shrink-0">
                          {p.teamTag}
                        </span>
                      )}
                      {isSel && (
                        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {allowClear && selected && (
            <div className="border-t border-gray-100 dark:border-gray-800 p-2">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onClear?.();
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-center text-xs text-gray-500 dark:text-gray-400 py-1 hover:text-gray-700 dark:hover:text-gray-200"
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
