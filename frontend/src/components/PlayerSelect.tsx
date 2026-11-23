import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Avatar } from "./Avatar";

export interface SelectablePlayer {
  id: number;
  name: string;
  avatarUrl?: string | null;
  /** Match side used to filter the scorer, assist and keeper pools. */
  teamTag?: string;
}

interface PlayerSelectProps {
  label: string;
  players: SelectablePlayer[];
  selected: SelectablePlayer | null;
  onSelect: (player: SelectablePlayer) => void;
  onClear?: () => void;
  disabled?: boolean;
}

export function PlayerSelect({ label, players, selected, onSelect, onClear, disabled }: PlayerSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    rootRef.current?.scrollIntoView?.({ block: "nearest" });

    const onOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onOutsideClick);
    return () => document.removeEventListener("click", onOutsideClick);
  }, [open]);

  function closeAndFocus() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  const shown = selected && !players.some((player) => player.id === selected.id)
    ? [selected, ...players]
    : players;

  return (
    <div ref={rootRef}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") return;
        event.stopPropagation();
        closeAndFocus();
      }}
    >
      <p id={`${id}-label`} className="mb-1.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
        {label}
      </p>
      <button ref={triggerRef} type="button" disabled={disabled} onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full items-center gap-2 border border-line bg-raised px-3 py-2 text-left text-sm text-ink disabled:opacity-50"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open} aria-controls={open ? `${id}-players` : undefined}>
        {selected && <span aria-hidden="true"><Avatar url={selected.avatarUrl} username={selected.name} size="sm" /></span>}
        <span id={`${id}-value`} className="min-w-0 flex-1 break-words">
          {selected?.name ?? "Select player"}
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-ink-dim ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div id={`${id}-players`} className="mt-1 border border-line bg-panel">
          {shown.length > 0 ? (
            <ul aria-labelledby={`${id}-label`} className="grid grid-cols-2 gap-px bg-line">
              {shown.map((player) => {
                const isSelected = selected?.id === player.id;
                return (
                  <li key={player.id} className="min-w-0 last:odd:col-span-2">
                    <button type="button" onClick={() => { onSelect(player); closeAndFocus(); }}
                      aria-pressed={isSelected}
                      className={`flex h-full min-h-12 w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${
                        isSelected ? "bg-raised font-semibold text-live" : "bg-panel text-ink hover:bg-raised"
                      }`}>
                      <span aria-hidden="true"><Avatar url={player.avatarUrl} username={player.name} size="sm" /></span>
                      <span className="min-w-0 flex-1 break-words">{player.name}</span>
                      {isSelected && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-3 text-sm text-ink-dim">No eligible players.</p>
          )}
          {onClear && selected && (
            <button type="button" onClick={() => { onClear(); closeAndFocus(); }}
              className="min-h-12 w-full border-t border-line px-3 py-2 text-center text-sm text-ink-dim hover:bg-raised hover:text-ink">
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
