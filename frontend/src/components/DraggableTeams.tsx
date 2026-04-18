import React, { useMemo } from 'react';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Scale } from 'lucide-react';
import type { Session, User } from '../types';
import { teamSkillBalanceSummary } from '../services/teamService';
import { TeamPlayerRow } from './TeamPlayerRow';

const TEAM_ACCENTS = [
  'border-l-blue-500',
  'border-l-rose-500',
  'border-l-emerald-500',
  'border-l-amber-500',
] as const;

interface DraggableTeamsProps {
  session: Session;
  onMovePlayer: (
    playerId: string,
    sourceTeamId: string,
    destTeamId: string
  ) => void | Promise<void>;
  onToggleLock: (userId: string) => void;
  /** Only admins may drag players between teams (local preview; not persisted). */
  canDragTeams: boolean;
}

function DroppableTeamBody({
  teamId,
  children,
}: {
  teamId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: teamId });

  return (
    <div
      ref={setNodeRef}
      className={`grid gap-2 min-h-[100px] rounded-lg transition-colors ${
        isOver
          ? 'bg-violet-50/80 ring-2 ring-violet-400/60 dark:bg-violet-950/40 dark:ring-violet-500/50'
          : ''
      }`}
    >
      {children}
    </div>
  );
}

function DraggablePlayer({
  player,
  teamId,
  onToggleLock,
}: {
  player: User;
  teamId: string;
  onToggleLock: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: player.id,
    data: { teamId },
    disabled: player.isLocked,
  });

  const translate = CSS.Translate.toString(transform);
  const style: React.CSSProperties = {
    transform:
      translate != null
        ? `${translate} scale(${isDragging ? 1.05 : 1})`
        : isDragging
          ? 'scale(1.05)'
          : undefined,
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.98 : 1,
    transition: isDragging ? 'none' : 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`rounded-lg ${
        player.isLocked
          ? 'cursor-not-allowed'
          : 'cursor-grab active:cursor-grabbing [-webkit-tap-highlight-color:transparent]'
      }`}
    >
      <TeamPlayerRow player={player} draggable={false} onToggleLock={onToggleLock} />
    </div>
  );
}

function mergePlayerWithAttendance(
  session: Session,
  player: User
): User {
  const att = session.attendance.find((a) => a.id === player.id);
  const merged = { ...player, ...att };
  merged.isLocked = att?.isLocked ?? player.isLocked;
  return merged;
}

export const DraggableTeams: React.FC<DraggableTeamsProps> = ({
  session,
  onMovePlayer,
  onToggleLock,
  canDragTeams,
}) => {
  const { totals, balanced, maxDiff } = teamSkillBalanceSummary(session.teams);
  const parts = totals.map((total, i) => `Team ${i + 1}: ${total}`);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 280,
        tolerance: 8,
      },
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const playerId = active.id as string;
    const overId = String(over.id);

    const sourceTeam = session.teams.find((t) => t.players.some((p) => p.id === playerId));
    if (!sourceTeam) return;

    let destTeamId: string | undefined;
    if (session.teams.some((t) => t.id === overId)) {
      destTeamId = overId;
    } else {
      destTeamId = session.teams.find((t) => t.players.some((p) => p.id === overId))?.id;
    }

    if (destTeamId && destTeamId !== sourceTeam.id) {
      onMovePlayer(playerId, sourceTeam.id, destTeamId);
    }
  };

  const skillBanner = useMemo(
    () =>
      totals.length > 0 ? (
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
      ) : null,
    [totals.length, parts, maxDiff, balanced]
  );

  const grid = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {session.teams.map((team, index) => (
        <div
          key={team.id}
          className={`border-l-4 ${TEAM_ACCENTS[index % TEAM_ACCENTS.length]} p-4 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-xl space-y-4`}
        >
          <div className="flex justify-between items-center border-b border-gray-200 dark:border-gray-800 pb-2">
            <h3 className="font-bold text-lg text-purple-600 dark:text-purple-400">
              Team {index + 1}
            </h3>
            <span className="text-sm text-gray-500">{team.players.length} Players</span>
          </div>
          {canDragTeams ? (
            <DroppableTeamBody teamId={team.id}>
              {team.players.map((player) => (
                <DraggablePlayer
                  key={player.id}
                  player={mergePlayerWithAttendance(session, player)}
                  teamId={team.id}
                  onToggleLock={onToggleLock}
                />
              ))}
            </DroppableTeamBody>
          ) : (
            <div className="grid gap-2 min-h-[100px]">
              {team.players.map((player) => (
                <TeamPlayerRow
                  key={player.id}
                  player={mergePlayerWithAttendance(session, player)}
                  draggable={false}
                  onToggleLock={onToggleLock}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  if (!canDragTeams) {
    return (
      <>
        {skillBanner}
        {grid}
      </>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragEnd={handleDragEnd}
    >
      {skillBanner}
      {grid}
    </DndContext>
  );
};
