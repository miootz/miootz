import React from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Scale } from 'lucide-react';
import type { Session } from '../types';
import { teamSkillBalanceSummary } from '../services/teamService';
import { SortablePlayer } from './SortablePlayer';

const TEAM_ACCENTS = [
  'border-l-blue-500',
  'border-l-rose-500',
  'border-l-emerald-500',
  'border-l-amber-500',
] as const;

interface DraggableTeamsProps {
  session: Session;
  onToggleLock: (userId: string) => void;
  onMovePlayer: (playerId: string, sourceTeamId: string, destTeamId: string) => void;
}

export const DraggableTeams: React.FC<DraggableTeamsProps> = ({
  session,
  onMovePlayer,
}) => {
  const { totals, balanced, maxDiff } = teamSkillBalanceSummary(session.teams);
  const parts = totals.map((total, i) => `Team ${i + 1}: ${total}`);

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
      {totals.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm dark:border-gray-800 dark:bg-gray-900/40">
          <Scale
            className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400"
            aria-hidden
          />
          <span className="font-medium text-gray-800 dark:text-gray-200">
            Skill totals
          </span>
          <span className="text-gray-600 dark:text-gray-400">
            {parts.join(' · ')}
            {maxDiff > 0 && (
              <span className="text-gray-500 dark:text-gray-500">
                {' '}
                (spread {maxDiff})
              </span>
            )}
          </span>
          <span
            className={
              balanced
                ? 'ml-auto inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                : 'ml-auto inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/80 dark:text-amber-200'
            }
          >
            {balanced ? 'Balanced ✓' : 'Uneven'}
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {session.teams.map((team, index) => (
          <div
            key={team.id}
            className={`border-l-4 ${TEAM_ACCENTS[index % TEAM_ACCENTS.length]} p-4 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-xl space-y-4`}
          >
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
