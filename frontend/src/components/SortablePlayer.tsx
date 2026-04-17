import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { User } from '../types';
import { PlayerAvatarFace, SkillBadge } from './PlayerAvatar';

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
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <PlayerAvatarFace name={player.name} avatarUrl={player.avatarUrl} size="sm" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
          {player.name}
        </span>
      </div>
      <SkillBadge score={player.skillScore} size="sm" />
    </div>
  );
};
