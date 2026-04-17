import React from 'react';
import type { User } from '../types';
import { Lock, Unlock } from 'lucide-react';
import { PlayerAvatarFace, SkillBadge } from './PlayerAvatar';

interface PlayerCardProps {
  player: User;
  onToggleLock: (id: string) => void;
}

export const PlayerCard: React.FC<PlayerCardProps> = ({ player, onToggleLock }) => {
  const statusBorder =
    player.attendanceStatus === 'waitlisted'
      ? 'border-l-4 border-l-amber-500'
      : player.attendanceStatus === 'confirmed'
        ? 'border-l-4 border-l-emerald-500'
        : '';

  return (
    <div
      className={`flex items-center justify-between gap-2 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm transition-colors ${statusBorder}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <PlayerAvatarFace name={player.name} avatarUrl={player.avatarUrl} size="md" />
        <div className="flex flex-col min-w-0 gap-1">
          <span className="font-medium text-gray-900 dark:text-white truncate">
            {player.name}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <SkillBadge score={player.skillScore} size="md" />
            {player.attendanceStatus === 'waitlisted' && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-950/80 dark:text-amber-200">
                Waitlist
              </span>
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onToggleLock(player.id)}
        className={`shrink-0 p-2 rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${player.isLocked ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'}`}
        aria-label={player.isLocked ? 'Unlock player' : 'Lock player'}
      >
        {player.isLocked ? <Lock size={16} /> : <Unlock size={16} />}
      </button>
    </div>
  );
};
