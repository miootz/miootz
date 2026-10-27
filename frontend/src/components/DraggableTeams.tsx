import React from "react";
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
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Lock, Scale, Star, Unlock } from "lucide-react";
import type { Meetup, User } from "../types";
import { teamSkillBalanceSummary } from "../services/teamService";
import { PlayerAvatarFace } from "./PlayerAvatar";

interface DraggableTeamsProps {
  meetup: Meetup;
  onMovePlayer: (
    playerId: string,
    sourceTeamId: string,
    destTeamId: string,
  ) => void | Promise<void>;
  onToggleLock: (userId: string) => void;
  canDragTeams: boolean;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function mergePlayerWithAttendance(meetup: Meetup, player: User): User {
  const att = meetup.attendance.find((a) => a.id === player.id);
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
  if (
    player.secondarySpecialty &&
    player.secondarySpecialty !== player.primarySpecialty
  ) {
    parts.push(player.secondarySpecialty);
  }
  return parts.length > 0 ? `(${parts.join("/")})` : "";
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
        isOver
          ? "ring-2 ring-teal-400 ring-offset-2 dark:ring-teal-500"
          : ""
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
  const ratingValue = formatRating(player);
  const positions = formatPositions(player);

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
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
        transition: isDragging ? "none" : "opacity 0.15s",
      }
    : {};

  const rating = (
    <span className="inline-flex items-center gap-1 text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums shrink-0">
      <Star className="h-3.5 w-3.5 text-amber-500" aria-hidden />
      {ratingValue}
    </span>
  );

  const lockButton =
    canDrag && onToggleLock ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock(player.id);
        }}
        className={`p-1 rounded transition-colors shrink-0 ${
          player.isLocked
            ? "text-teal-500 hover:bg-teal-50 dark:hover:bg-teal-950/30"
            : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        }`}
        aria-label={player.isLocked ? "Unlock" : "Lock"}
      >
        {player.isLocked ? <Lock size={13} /> : <Unlock size={13} />}
      </button>
    ) : null;

  return (
    <div
      ref={canDrag ? setNodeRef : undefined}
      style={dragStyle}
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
      className={`group flex items-center gap-2.5 rounded-xl border px-3 py-2 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 transition-colors ${
        canDrag && !player.isLocked
          ? "cursor-grab active:cursor-grabbing hover:border-teal-300 dark:hover:border-teal-700 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
          : player.isLocked
            ? "opacity-60"
            : ""
      }`}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <PlayerAvatarFace
          name={player.name}
          avatarUrl={player.avatarUrl}
          size="sm"
          isPlusOne={player.isPlusOne}
        />
        {player.isLocked && (
          <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-teal-500 flex items-center justify-center shadow">
            <Lock size={9} className="text-white" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {/* Row 1 — name (full on mobile); positions + rating inline on sm+ */}
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 text-sm font-medium text-gray-900 dark:text-gray-100 break-words sm:truncate">
            {player.name}
          </span>
          {positions && (
            <span className="hidden text-2xs text-gray-500 dark:text-gray-400 sm:inline sm:shrink-0">
              {positions}
            </span>
          )}
          <span className="hidden sm:inline-flex sm:shrink-0">{rating}</span>
          <span className="hidden sm:inline-block sm:shrink-0">{lockButton}</span>
        </div>
        {/* Row 2 — mobile only: same info so the name owns the whole row */}
        <div className="mt-0.5 flex items-center gap-1.5 sm:hidden">
          {positions && (
            <span className="text-2xs text-gray-500 dark:text-gray-400">
              {positions}
            </span>
          )}
          {rating}
          {lockButton}
        </div>
      </div>
    </div>
  );
}

/* ── Skill banner ────────────────────────────────────────────────── */

function SkillBanner({ meetup }: { meetup: Meetup }) {
  const { totals, balanced, maxDiff } = teamSkillBalanceSummary(meetup.teams);
  if (totals.length === 0) return null;

  const parts = totals.map((total, i) => {
    const teamName = meetup.teams[i]?.name ?? `Team ${i + 1}`;
    return `${teamName}: ${total.toFixed(1)}`;
  });

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <Scale
        className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400"
        aria-hidden
      />
      <span className="font-medium text-gray-800 dark:text-gray-200">
        Skill totals
      </span>
      <span className="text-gray-600 dark:text-gray-400">
        {parts.join(" \u00B7 ")}
        {maxDiff > 0 && (
          <span className="text-gray-500 dark:text-gray-400">
            {" "}
            (spread {maxDiff.toFixed(1)})
          </span>
        )}
      </span>
      <span
        className={
          balanced
            ? "ml-auto inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
            : "ml-auto inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/80 dark:text-amber-200"
        }
      >
        {balanced ? "Balanced \u2713" : "Uneven"}
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
        <h3 className="font-bold text-base text-teal-700 dark:text-teal-400">
          {team.name ?? `Team ${index + 1}`}
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {players.length} player{players.length !== 1 ? "s" : ""}
        </span>
      </div>
      {players.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-6 text-center">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            No players yet
          </span>
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
  meetup,
  onMovePlayer,
  onToggleLock,
  canDragTeams,
}) => {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 280, tolerance: 8 },
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const playerId = active.id as string;
    const overId = String(over.id);

    const sourceTeam = meetup.teams.find((t) =>
      t.players.some((p) => p.id === playerId),
    );
    if (!sourceTeam) return;

    let destTeamId: string | undefined;
    if (meetup.teams.some((t) => t.id === overId)) {
      destTeamId = overId;
    } else {
      destTeamId = meetup.teams.find((t) =>
        t.players.some((p) => p.id === overId),
      )?.id;
    }

    if (destTeamId && destTeamId !== sourceTeam.id) {
      onMovePlayer(playerId, sourceTeam.id, destTeamId);
    }
  };

  return (
    <>
      <SkillBanner meetup={meetup} />
      {canDragTeams ? (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {meetup.teams.map((team, index) => {
              const players = team.players.map((p) =>
                mergePlayerWithAttendance(meetup, p),
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
          {meetup.teams.map((team, index) => {
            const players = team.players.map((p) =>
              mergePlayerWithAttendance(meetup, p),
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
