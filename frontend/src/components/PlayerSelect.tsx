import { Check } from "lucide-react";
import { Avatar } from "./Avatar";

export interface SelectablePlayer {
  id: number;
  name: string;
  avatarUrl?: string | null;
}

export function PlayerSelect({ label, side, players, selected, onSelect }: {
  label: string;
  side?: "a" | "b";
  players: SelectablePlayer[];
  selected: SelectablePlayer | null;
  onSelect: (player: SelectablePlayer) => void;
}) {
  const teamColor = side === "a" ? "bg-team-a text-white" : "bg-team-b text-white";
  return (
    <div className="min-w-0">
      <p className={`px-2.5 py-2 text-xs font-bold ${side ? teamColor : "bg-raised text-ink"}`}>{label}</p>
      {players.length ? (
        <ul aria-label={label} className={`grid gap-px border border-line bg-line ${side ? "grid-cols-1" : "grid-cols-2"}`}>
          {players.map((player) => {
            const isSelected = selected?.id === player.id;
            return (
              <li key={player.id} className={side ? "min-w-0" : "min-w-0 last:odd:col-span-2"}>
                <button type="button" onClick={() => onSelect(player)} aria-pressed={isSelected}
                  className={`flex h-full min-h-12 w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${
                    isSelected ? "bg-raised font-semibold text-live" : "bg-panel text-ink hover:bg-raised"
                  }`}>
                  <span aria-hidden="true" className={side ? "max-[360px]:hidden" : undefined}>
                    <Avatar url={player.avatarUrl} username={player.name} size="sm" />
                  </span>
                  <span className="min-w-0 flex-1 break-words">{player.name}</span>
                  {isSelected && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border border-line p-3 text-sm text-ink-dim">No eligible players.</p>
      )}
    </div>
  );
}
