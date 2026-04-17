import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { User } from '../types';

interface SortablePlayerProps {
  player: User;
  id: string;
}

export const SortablePlayer: React.FC<SortablePlayerProps> = ({ player, id }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners}
      className="flex justify-between items-center gap-2 p-2 bg-white dark:bg-gray-800 rounded border border-gray-100 dark:border-gray-700 cursor-grab active:cursor-grabbing hover:border-purple-400 dark:hover:border-purple-500 transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        {player.avatarUrl ? (
          <img
            src={player.avatarUrl}
            alt=""
            className="w-8 h-8 rounded-full object-cover shrink-0 bg-gray-200 dark:bg-gray-700"
          />
        ) : (
          <div
            className="w-8 h-8 rounded-full shrink-0 bg-gray-200 dark:bg-gray-700"
            aria-hidden
          />
        )}
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
          {player.name}
        </span>
      </div>
      <span className="text-xs text-gray-400 shrink-0">{player.skillScore}</span>
    </div>
  );
};
