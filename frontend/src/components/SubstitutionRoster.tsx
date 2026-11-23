import type { ReactNode } from "react";

export interface SubstitutionPlayer {
  id: number;
  display_name: string;
  pac?: number | null;
  dri?: number | null;
  inAnotherMatch?: boolean;
}

export function SubstitutionRoster({ name, side, players, selectedId, disabled, onPick, actions }: {
  name: string;
  side: "a" | "b" | null;
  players: SubstitutionPlayer[];
  selectedId?: number;
  disabled: boolean;
  onPick: (id: number) => void;
  actions?: (player: SubstitutionPlayer) => ReactNode;
}) {
  const heading = side === "a" ? "bg-team-a text-white"
    : side === "b" ? "bg-team-b text-white" : "bg-raised text-ink-dim";
  return (
    <div className={`min-w-0 space-y-1.5 ${side === null ? "col-span-2" : ""}`}>
      <div className={`flex items-center justify-between px-3 py-2 ${heading}`}>
        <span className="truncate text-xs font-bold uppercase tracking-wide">{name}</span>
        <span className="text-xs font-bold tabular-nums">{players.length}</span>
      </div>
      <ul aria-label={name} className="divide-y divide-line bg-panel">
        {players.map((player) => {
          const selected = selectedId === player.id;
          return (
            <li key={player.id}>
              <button type="button" onClick={() => onPick(player.id)} disabled={disabled}
                className={`min-h-12 w-full break-words px-3 py-2 text-left text-sm disabled:opacity-50 ${
                  selected ? "bg-live/10 font-semibold text-live" : "text-ink hover:bg-raised"
                }`}
                aria-pressed={selected}>
                {player.display_name}
                {(player.pac ?? 3) > 3 && <span className="ml-1 text-2xs font-bold text-attribute-pac">PAC</span>}
                {(player.dri ?? 3) > 3 && <span className="ml-1 text-2xs font-bold text-attribute-dri">DRI</span>}
              </button>
              {selected && actions?.(player)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
