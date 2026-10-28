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
import { Scale } from "lucide-react";
import type { Meetup, User } from "../types";
import { teamSkillBalanceSummary } from "../services/teamService";
import { TeamPlayerCard } from "./TeamPlayerCard";

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
          ? "ring-2 ring-live ring-offset-2 ring-offset-board"
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
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: player.id,
      data: { teamId },
      disabled: !canDrag || player.isLocked,
    });

  const translate = CSS.Translate.toString(transform);
  return (
    <TeamPlayerCard
      player={player}
      canDrag={canDrag}
      onToggleLock={onToggleLock}
      cardRef={canDrag ? setNodeRef : undefined}
      style={
        canDrag
          ? {
              transform: translate != null ? translate : undefined,
              zIndex: isDragging ? 50 : 1,
              opacity: isDragging ? 0.5 : 1,
              transition: isDragging ? "none" : "opacity 0.15s",
            }
          : undefined
      }
      dragProps={canDrag ? { ...listeners, ...attributes } : undefined}
    />
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
        className="h-4 w-4 shrink-0 text-ink-dim"
        aria-hidden
      />
      <span className="font-medium text-ink">
        Skill totals
      </span>
      <span className="tabular-nums text-ink-dim">
        {parts.join(" \u00B7 ")}
        {maxDiff > 0 && (
          <span className="text-ink-faint">
            {" "}
            (spread {maxDiff.toFixed(1)})
          </span>
        )}
      </span>
      <span
        className={
          balanced
            ? "ml-auto inline-flex items-center bg-team-a/15 px-2 py-0.5 text-xs font-medium text-team-a"
            : "ml-auto inline-flex items-center bg-live/15 px-2 py-0.5 text-xs font-medium text-live"
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
      <div
        className={`flex justify-between items-center px-3 py-2 ${
          index === 0
            ? "bg-team-a text-white"
            : index === 1
              ? "bg-team-b text-white"
              : "bg-raised text-ink"
        }`}
      >
        <h3 className="font-bold text-sm uppercase tracking-wide">
          {team.name ?? `Team ${index + 1}`}
        </h3>
        <span className="text-xs tabular-nums opacity-80">
          {players.length} player{players.length !== 1 ? "s" : ""}
        </span>
      </div>
      {players.length === 0 ? (
        <div className="border border-line bg-panel px-4 py-6 text-center">
          <span className="text-sm text-ink-faint">
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
