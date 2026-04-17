import React from 'react';
import type { User } from '../types';
import { Lock, Unlock } from 'lucide-react';

interface PlayerCardProps {
  player: User;
  onToggleLock: (id: string) => void;
}

export const PlayerCard: React.FC<PlayerCardProps> = ({ player, onToggleLock }) => {
  return (
    <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        {player.avatarUrl ? (
          <img
            src={player.avatarUrl}
            alt=""
            className="w-10 h-10 rounded-full object-cover shrink-0 bg-gray-200 dark:bg-gray-700"
          />
        ) : (
          <div
            className="w-10 h-10 rounded-full shrink-0 bg-gray-200 dark:bg-gray-700"
            aria-hidden
          />
        )}
        <div className="flex flex-col min-w-0">
          <span className="font-medium text-gray-900 dark:text-white truncate">
            {player.name}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Skill: {player.skillScore}
          </span>
        </div>
      </div>
      <button 
        onClick={() => onToggleLock(player.id)}
        className={`p-2 rounded-full transition-colors ${player.isLocked ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'}`}
      >
        {player.isLocked ? <Lock size={16} /> : <Unlock size={16} />}
      </button>
    </div>
  );
};
