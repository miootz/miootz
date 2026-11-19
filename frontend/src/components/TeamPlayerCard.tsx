import React from "react";
import { Lock, Star, Unlock } from "lucide-react";
import type { User } from "../types";
import { PlayerAvatarFace } from "./PlayerAvatar";
import { PlayerEditLink } from "./PlayerEditLink";

/*
 * Single source of UI truth for a team player row: avatar (spans both rows),
 * name on top, positions + computed rating below, lock toggle (spans rows).
 * DraggableTeams wraps this with dnd-kit wiring (dragProps/style/cardRef).
 */

function formatPositions(player: User): string {
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

/** Star rating: selected player skill, or the draft estimate when unrated. */
export const SkillRating: React.FC<{
  calculated: number | null | undefined;
  raw: number | null | undefined;
}> = ({ calculated, raw }) => {
  const value = calculated ?? raw ?? 0;
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
  /** True for the signed-in player's own row — highlighted with a "You" chip. */
  isMe?: boolean;
  linkToPlayer?: boolean;
}> = ({ player, canDrag, onToggleLock, cardRef, style, dragProps, isMe, linkToPlayer }) => {
  const positions = formatPositions(player);
  const nameClass = "text-sm font-medium text-ink truncate";

  const lockButton =
    canDrag && onToggleLock ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock(player.id);
        }}
        className={`relative z-10 p-1 transition-colors shrink-0 ${
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
      className={`group relative flex items-center gap-2.5 border px-3 py-2 transition-colors ${
        isMe
          ? "bg-live/10 border-live"
          : "bg-panel border-line"
      } ${
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
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {linkToPlayer ? (
            <PlayerEditLink playerId={player.id} className={nameClass} stretch>{player.name}</PlayerEditLink>
          ) : (
            <span className={nameClass}>{player.name}</span>
          )}
          {(player.pac ?? 3) > 3 && <span className="text-2xs font-bold text-ink-dim shrink-0">PAC</span>}
          {(player.dri ?? 3) > 3 && <span className="text-2xs font-bold text-ink-dim shrink-0">DRI</span>}
          {isMe && (
            <span className="shrink-0 rounded bg-live/20 px-1.5 py-0.5 text-2xs font-semibold text-live">
              You
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
          {positions && (
            <span className="min-w-0 text-2xs text-ink-faint truncate">
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
