import React from "react";
import { Lock, Star, Unlock } from "lucide-react";
import type { User } from "../types";
import { PlayerAvatarFace } from "./PlayerAvatar";

/*
 * Single source of UI truth for a team player row: avatar + lock badge,
 * name (full on mobile), positions, computed rating, lock toggle.
 * DraggableTeams wraps this with dnd-kit wiring (dragProps/style/cardRef).
 */

export function formatRating(player: User): string {
  if (player.calculatedSkill != null && player.calculatedSkill > 0) {
    return player.calculatedSkill.toFixed(1);
  }
  return Math.round(player.skillScore).toFixed(1);
}

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

export const TeamPlayerCard: React.FC<{
  player: User;
  canDrag: boolean;
  onToggleLock?: (id: string) => void;
  cardRef?: React.Ref<HTMLDivElement>;
  style?: React.CSSProperties;
  /** Spread of dnd-kit listeners/attributes (drag surface = whole card). */
  dragProps?: React.HTMLAttributes<HTMLDivElement>;
}> = ({ player, canDrag, onToggleLock, cardRef, style, dragProps }) => {
  const ratingValue = formatRating(player);
  const positions = formatPositions(player);

  const rating = (
    <span className="inline-flex items-center gap-1 text-sm font-bold text-ink tabular-nums shrink-0">
      <Star className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
      {ratingValue}
    </span>
  );

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
      {/* Avatar */}
      <div className="relative shrink-0">
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
        {/* Row 1 — name (full on mobile); positions + rating inline on sm+ */}
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 text-sm font-medium text-ink break-words sm:truncate">
            {player.name}
          </span>
          {positions && (
            <span className="hidden text-2xs text-ink-faint sm:inline sm:shrink-0">
              {positions}
            </span>
          )}
          <span className="hidden sm:inline-flex sm:shrink-0">{rating}</span>
          <span className="hidden sm:inline-block sm:shrink-0">{lockButton}</span>
        </div>
        {/* Row 2 — mobile only: same info so the name owns the whole row */}
        <div className="mt-0.5 flex items-center gap-1.5 sm:hidden">
          {positions && (
            <span className="text-2xs text-ink-faint">
              {positions}
            </span>
          )}
          {rating}
          {lockButton}
        </div>
      </div>
    </div>
  );
};
