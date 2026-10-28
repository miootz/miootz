import React from 'react';
import type { User } from '../types';
import { Lock, Unlock } from 'lucide-react';
import { PlayerAvatarFace, SkillBadge } from './PlayerAvatar';

interface TeamPlayerRowProps {
  player: User;
  /** When false, row is read-only (no grab cursor on the row container). */
  draggable?: boolean;
  onToggleLock?: (id: string) => void;
}

export const TeamPlayerRow: React.FC<TeamPlayerRowProps> = ({
  player,
  draggable = false,
  onToggleLock,
}) => (
  <div
    className={`flex justify-between items-center gap-2 p-2 bg-panel border border-line transition-colors ${
      draggable
        ? 'cursor-grab active:cursor-grabbing hover:border-live/60'
        : 'cursor-default'
    }`}
  >
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <PlayerAvatarFace name={player.name} avatarUrl={player.avatarUrl} size="sm" isPlusOne={player.isPlusOne} />
      <span className="text-sm font-medium text-ink truncate">
        {player.name}
      </span>
    </div>
    <div className="flex shrink-0 items-center gap-1">

      <SkillBadge score={player.skillScore} size="sm" />
      {onToggleLock && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onToggleLock(player.id);
          }}
          className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors ${
            player.isLocked
              ? 'bg-live/15 text-live'
              : 'text-ink-faint hover:bg-raised'
          }`}
          aria-label={player.isLocked ? 'Unlock player' : 'Lock player to this team'}
        >
          {player.isLocked ? <Lock size={16} /> : <Unlock size={16} />}
        </button>
      )}
    </div>
  </div>
);
