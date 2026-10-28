import React from "react";
import { Lock, Star, Unlock } from "lucide-react";
import type { User } from "../types";
import { PlayerAvatarFace } from "./PlayerAvatar";

/*
 * Single source of UI truth for a team player row: avatar (spans both rows),
 * name on top, positions + computed rating below, lock toggle (spans rows).
 * DraggableTeams wraps this with dnd-kit wiring (dragProps/style/cardRef).
 */

export function formatPositions(player: User): string {
  const parts: string[] = [];
  if (player.primarySpecialty) parts.push(player.primarySpecialty);
  if (
    player.secondarySpecialty &&
    player.secondarySpecialty !== player.primarySpecialty
  ) {
    parts.push(player.secondarySpecialty);
  }
  return parts.length > 0 ? `(${parts.join("/")})` : "";
}

/** Star rating: computed skill when present, rounded raw skill otherwise. */
export const SkillRating: React.FC<{
  calculated: number | null | undefined;
  raw: number | null | undefined;
}> = ({ calculated, raw }) => {
  const value =
    calculated != null && calculated > 0 ? calculated : Math.round(raw ?? 0);
  return (
    <span className="inline-flex items-center gap-1 text-sm font-bold text-ink tabular-nums shrink-0">
      <Star className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
      {value.toFixed(1)}
    </span>
  );
};

export const TeamPlayerCard: React.FC<{
  player: User;
  canDrag: boolean;
  onToggleLock?: (id: string) => void;
  cardRef?: React.Ref<HTMLDivElement>;
  style?: React.CSSProperties;
  /** Spread of dnd-kit listeners/attributes (drag surface = whole card). */
  dragProps?: React.HTMLAttributes<HTMLDivElement>;
}> = ({ player, canDrag, onToggleLock, cardRef, style, dragProps }) => {
  const positions = formatPositions(player);

  const lockButton =
    canDrag && onToggleLock ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock(player.id);
        }}
        className={`p-1 transition-colors shrink-0 ${
          player.isLocked
            ? "text-live hover:bg-live/10"
            : "text-ink-faint hover:bg-raised"
        }`}
        aria-label={player.isLocked ? "Unlock" : "Lock"}
      >
        {player.isLocked ? <Lock size={13} /> : <Unlock size={13} />}
      </button>
    ) : null;

  return (
    <div
      ref={cardRef}
      style={style}
      {...dragProps}
      className={`group flex items-center gap-2.5 border px-3 py-2 bg-panel border-line transition-colors ${
        canDrag && !player.isLocked
          ? "cursor-grab active:cursor-grabbing hover:border-live/60 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
          : player.isLocked
            ? "opacity-60"
            : ""
      }`}
    >
      {/* Avatar — spans both rows */}
      <div className="relative shrink-0 self-stretch flex items-center">
        <PlayerAvatarFace
          name={player.name}
          avatarUrl={player.avatarUrl}
          size="sm"
          isPlusOne={player.isPlusOne}
        />
        {player.isLocked && (
          <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-live flex items-center justify-center">
            <Lock size={9} className="text-board" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink truncate">
          {player.name}
        </span>
        <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
          {positions && (
            <span className="text-2xs text-ink-faint truncate">
              {positions}
            </span>
          )}
          <SkillRating
            calculated={player.calculatedSkill}
            raw={player.skillScore}
          />
        </div>
      </div>

      {/* Lock toggle — spans both rows */}
      {lockButton}
    </div>
  );
};
