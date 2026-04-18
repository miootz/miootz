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
    className={`flex justify-between items-center gap-2 p-2 bg-white dark:bg-gray-800 rounded border border-gray-100 dark:border-gray-700 transition-colors ${
      draggable
        ? 'cursor-grab active:cursor-grabbing hover:border-purple-400 dark:hover:border-purple-500'
        : 'cursor-default'
    }`}
  >
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <PlayerAvatarFace name={player.name} avatarUrl={player.avatarUrl} size="sm" />
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
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
          className={`p-2 rounded-full transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center ${
            player.isLocked
              ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
              : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
          }`}
          aria-label={player.isLocked ? 'Unlock player' : 'Lock player to this team'}
        >
          {player.isLocked ? <Lock size={16} /> : <Unlock size={16} />}
        </button>
      )}
    </div>
  </div>
);
