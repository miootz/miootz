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
      <div className="flex flex-col">
        <span className="font-medium text-gray-900 dark:text-white">{player.name}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">Skill: {player.skillScore}</span>
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
