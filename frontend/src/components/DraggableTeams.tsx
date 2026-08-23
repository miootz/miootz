import React from 'react';
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
import { GripVertical, Lock, Scale, Star, Unlock } from 'lucide-react';
import type { Session, User } from '../types';
import { teamSkillBalanceSummary } from '../services/teamService';
import { PlayerAvatarFace } from './PlayerAvatar';

interface DraggableTeamsProps {
  session: Session;
  onMovePlayer: (
    playerId: string,
    sourceTeamId: string,
    destTeamId: string,
  ) => void | Promise<void>;
  onToggleLock: (userId: string) => void;
  canDragTeams: boolean;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function mergePlayerWithAttendance(session: Session, player: User): User {
  const att = session.attendance.find((a) => a.id === player.id);
  const merged = { ...player, ...att };
  merged.isLocked = att?.isLocked ?? player.isLocked;
  return merged;
}

function formatRating(player: User): string {
  if (player.calculatedSkill != null && player.calculatedSkill > 0) {
    return player.calculatedSkill.toFixed(1);
  }
  return Math.round(player.skillScore).toFixed(1);
}

function formatPositions(player: User): string {
  const parts: string[] = [];
  if (player.primarySpecialty) parts.push(player.primarySpecialty);
  if (player.secondarySpecialty && player.secondarySpecialty !== player.primarySpecialty) {
    parts.push(player.secondarySpecialty);
  }
  return parts.length > 0 ? `(${parts.join('/')})` : '';
}

/* ── Droppable team column ───────────────────────────────────────── */

function DroppableZone({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-droppable-id={id}
      className={`transition-all duration-200 ${
        isOver ? 'ring-2 ring-violet-400 ring-offset-2 dark:ring-violet-500' : ''
      }`}
    >
      {children}
    </div>
  );
}

/* ── Player row (draggable when admin) ───────────────────────────── */

function PlayerRow({
  player,
  teamId,
  onToggleLock,
  canDrag,
}: {
  player: User;
  teamId: string;
  onToggleLock?: (id: string) => void;
  canDrag: boolean;
}) {
  const rating = formatRating(player);
  const positions = formatPositions(player);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: player.id,
    data: { teamId },
    disabled: !canDrag || player.isLocked,
  });

  const translate = CSS.Translate.toString(transform);
  const dragStyle: React.CSSProperties = canDrag
    ? {
        transform: translate != null ? translate : undefined,
        zIndex: isDragging ? 50 : 1,
        opacity: isDragging ? 0.5 : 1,
        transition: isDragging ? 'none' : 'opacity 0.15s',
      }
    : {};

  return (
    <div
      ref={canDrag ? setNodeRef : undefined}
      style={dragStyle}
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
      className={`group flex items-center gap-2.5 rounded-xl border px-3 py-2 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 transition-colors ${
        canDrag && !player.isLocked
          ? 'cursor-grab active:cursor-grabbing hover:border-violet-300 dark:hover:border-violet-600 [-webkit-tap-highlight-color:transparent]'
          : player.isLocked
            ? 'opacity-60'
            : ''
      }`}
    >
      {/* Drag handle (admin only, not locked) */}
      {canDrag && !player.isLocked && (
        <GripVertical
          className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400"
          aria-hidden
        />
      )}

      {/* Avatar */}
      <div className="relative shrink-0">
        <PlayerAvatarFace name={player.name} avatarUrl={player.avatarUrl} size="sm" isPlusOne={player.isPlusOne} />
        {player.isLocked && (
          <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-violet-500 flex items-center justify-center shadow">
            <Lock size={9} className="text-white" />
          </div>
        )}

      </div>

      {/* Name + position */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {player.name}
          </span>
          {positions && (
            <span className="text-[11px] text-gray-500 dark:text-gray-400 shrink-0">
              {positions}
            </span>
          )}
        </div>
      </div>

      {/* Computed rating */}
      <span className="inline-flex items-center gap-1 text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums shrink-0">
        <Star className="h-3.5 w-3.5 text-amber-500" aria-hidden />
        {rating}
      </span>

      {/* Lock toggle (admin only) */}
      {canDrag && onToggleLock && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(player.id);
          }}
          className={`p-1 rounded transition-colors shrink-0 ${
            player.isLocked
              ? 'text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-950/30'
              : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          aria-label={player.isLocked ? 'Unlock' : 'Lock'}
        >
          {player.isLocked ? <Lock size={13} /> : <Unlock size={13} />}
        </button>
      )}
    </div>
  );
}

/* ── Skill banner ────────────────────────────────────────────────── */

function SkillBanner({ session }: { session: Session }) {
  const { totals, balanced, maxDiff } = teamSkillBalanceSummary(session.teams);
  if (totals.length === 0) return null;

  const parts = totals.map((total, i) => {
    const teamName = session.teams[i]?.name ?? `Team ${i + 1}`;
    return `${teamName}: ${total}`;
  });

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <Scale className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
      <span className="font-medium text-gray-800 dark:text-gray-200">Skill totals</span>
      <span className="text-gray-600 dark:text-gray-400">
        {parts.join(' \u00B7 ')}
        {maxDiff > 0 && (
          <span className="text-gray-500 dark:text-gray-500"> (spread {maxDiff})</span>
        )}
      </span>
      <span
        className={
          balanced
            ? 'ml-auto inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
            : 'ml-auto inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/80 dark:text-amber-200'
        }
      >
        {balanced ? 'Balanced \u2713' : 'Uneven'}
      </span>
    </div>
  );
}

/* ── Team column ─────────────────────────────────────────────────── */

function TeamColumn({
  team,
  index,
  players,
  onToggleLock,
  canDrag,
}: {
  team: { id: string; name?: string };
  index: number;
  players: User[];
  onToggleLock?: (id: string) => void;
  canDrag: boolean;
}) {
  const content = (
    <div className="space-y-2">
      <div className="flex justify-between items-center px-1">
        <h3 className="font-bold text-base text-purple-600 dark:text-purple-400">
          {team.name ?? `Team ${index + 1}`}
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {players.length} player{players.length !== 1 ? 's' : ''}
        </span>
      </div>
      {players.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-6 text-center">
          <span className="text-sm text-gray-500 dark:text-gray-400">No players yet</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {players.map((player) => (
            <PlayerRow
              key={player.id}
              player={player}
              teamId={team.id}
              onToggleLock={canDrag ? onToggleLock : undefined}
              canDrag={canDrag}
            />
          ))}
        </div>
      )}
    </div>
  );

  if (canDrag) {
    return <DroppableZone id={team.id}>{content}</DroppableZone>;
  }
  return <div>{content}</div>;
}

/* ── Main component ──────────────────────────────────────────────── */

export const DraggableTeams: React.FC<DraggableTeamsProps> = ({
  session,
  onMovePlayer,
  onToggleLock,
  canDragTeams,
}) => {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
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

  return (
    <>
      <SkillBanner session={session} />
      {canDragTeams ? (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {session.teams.map((team, index) => {
              const players = team.players.map((p) =>
                mergePlayerWithAttendance(session, p),
              );
              return (
                <TeamColumn
                  key={team.id}
                  team={team}
                  index={index}
                  players={players}
                  onToggleLock={onToggleLock}
                  canDrag={canDragTeams}
                />
              );
            })}
          </div>
        </DndContext>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {session.teams.map((team, index) => {
            const players = team.players.map((p) =>
              mergePlayerWithAttendance(session, p),
            );
            return (
              <TeamColumn
                key={team.id}
                team={team}
                index={index}
                players={players}
                canDrag={false}
              />
            );
          })}
        </div>
      )}
    </>
  );
};
