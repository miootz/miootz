import React from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Session } from '../types';
import { SortablePlayer } from './SortablePlayer';

interface DraggableTeamsProps {
  session: Session;
  onToggleLock: (userId: string) => void;
  onMovePlayer: (playerId: string, sourceTeamId: string, destTeamId: string) => void;
}

export const DraggableTeams: React.FC<DraggableTeamsProps> = ({
  session,
  onMovePlayer,
}) => {
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const playerId = active.id as string;
    const overId = over.id as string;

    // Find source team
    const sourceTeam = session.teams.find(t => t.players.some(p => p.id === playerId));
    if (!sourceTeam) return;

    // Determine destination team
    let destTeamId = overId;
    if (!session.teams.find(t => t.id === overId)) {
      const playerInOver = session.teams.flatMap(t => t.players).find(p => p.id === overId);
      if (playerInOver) {
        destTeamId = session.teams.find(t => t.players.some(p => p.id === overId))?.id || sourceTeam.id;
      }
    }

    if (destTeamId !== sourceTeam.id) {
      onMovePlayer(playerId, sourceTeam.id, destTeamId);
    }
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {session.teams.map((team, index) => (
          <div key={team.id} className="p-4 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-200 dark:border-gray-800 pb-2">
              <h3 className="font-bold text-lg text-purple-600 dark:text-purple-400">Team {index + 1}</h3>
              <span className="text-sm text-gray-500">{team.players.length} Players</span>
            </div>
            <SortableContext items={team.players.map(p => p.id)} strategy={verticalListSortingStrategy}>
              <div className="grid gap-2 min-h-[100px]">
                {team.players.map(player => (
                  <SortablePlayer key={player.id} id={player.id} player={player} />
                ))}
              </div>
            </SortableContext>
          </div>
        ))}
      </div>
    </DndContext>
  );
};
