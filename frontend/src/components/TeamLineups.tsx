import { ArrowLeftRight, Loader2, Scale, Shuffle } from "lucide-react";
import type { Meetup, User } from "../types";
import { teamSkillBalanceSummary } from "../services/teamService";
import { TeamPlayerCard } from "./TeamPlayerCard";

interface SubstitutionsControls {
  active: boolean;
  selectedId?: string;
  saving: boolean;
  onToggle: () => void;
  onPick: (playerId: string, teamId: string) => void;
}

function mergePlayerWithAttendance(meetup: Meetup, player: User): User {
  const att = meetup.attendance.find((a) => a.id === player.id);
  return {
    ...player,
    ...att,
    skillScore: player.skillScore,
    calculatedSkill: player.calculatedSkill ?? att?.calculatedSkill,
    isLocked: att?.isLocked ?? player.isLocked,
  };
}

function SkillBanner({
  meetup,
  onReshuffle,
  reshuffling,
  substitutions,
}: {
  meetup: Meetup;
  onReshuffle?: () => void;
  reshuffling?: boolean;
  substitutions?: SubstitutionsControls;
}) {
  const { totals, balanced, maxDiff } = teamSkillBalanceSummary(meetup.teams);
  if (totals.length === 0) return null;

  const parts = totals.map((total, i) => {
    const teamName = meetup.teams[i]?.name ?? `Team ${i + 1}`;
    return `${teamName}: ${total.toFixed(1)}`;
  });

  const totalsText = (
    <>
      {parts.join(" \u00B7 ")}
      {maxDiff > 0 && (
        <span className="text-ink-faint">
          {" "}
          (spread {maxDiff.toFixed(1)})
        </span>
      )}
    </>
  );

  return (
    <div className="mb-4">
      {/* Mobile: state row → data row → full-width action; desktop stays one row */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
        <Scale
          className="h-4 w-4 shrink-0 text-ink-dim"
          aria-hidden
        />
        <span className="font-medium text-ink">
          Skill totals
        </span>
        <span className="hidden md:inline tabular-nums text-ink-dim">
          {totalsText}
        </span>
        <span
          className={
            balanced
              ? "md:ml-auto inline-flex items-center bg-team-a/15 px-2 py-0.5 text-xs font-medium text-team-a"
              : "md:ml-auto inline-flex items-center bg-live/15 px-2 py-0.5 text-xs font-medium text-live"
          }
        >
          {balanced ? "Balanced \u2713" : "Uneven"}
        </span>
      </div>
      <p className="mt-1.5 text-sm tabular-nums text-ink-dim md:hidden">
        {totalsText}
      </p>
      {onReshuffle && (
        <div className="mt-2 grid gap-2 md:flex md:flex-wrap">
          <button
            type="button"
            disabled={reshuffling || substitutions?.active}
            onClick={onReshuffle}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 border border-line px-3 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-60"
          >
            {reshuffling ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Shuffle className="size-4" aria-hidden />}
            Reshuffle
          </button>
          {substitutions && (
            <button
              type="button"
              aria-pressed={substitutions.active}
              disabled={substitutions.saving || reshuffling}
              onClick={substitutions.onToggle}
              className={`inline-flex min-h-11 items-center justify-center gap-1.5 border px-3 text-sm font-medium disabled:opacity-60 ${substitutions.active ? "border-live bg-live/15 text-live" : "border-line text-ink-dim hover:bg-raised hover:text-ink"}`}
            >
              <ArrowLeftRight className="size-4" aria-hidden />
              Substitutions
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TeamColumn({
  team,
  index,
  players,
  onToggleLock,
  substitutions,
  currentUserId,
  linkToPlayers,
}: {
  team: { id: string; name?: string };
  index: number;
  players: User[];
  onToggleLock?: (id: string) => void;
  substitutions?: SubstitutionsControls;
  currentUserId?: string;
  linkToPlayers?: boolean;
}) {
  return (
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
            <TeamPlayerCard
              key={player.id}
              player={player}
              onToggleLock={substitutions?.active ? undefined : onToggleLock}
              onSelect={substitutions?.active ? () => substitutions.onPick(player.id, team.id) : undefined}
              selected={substitutions?.selectedId === player.id}
              selectionDisabled={substitutions?.saving}
              isMe={currentUserId != null && player.id === currentUserId}
              linkToPlayer={linkToPlayers}
            />
          ))}
        </div>
      )}
    </div>
  );

}

export function TeamLineups({
  meetup,
  onToggleLock,
  onReshuffle,
  reshuffling,
  substitutions,
  currentUserId,
  linkToPlayers,
}: {
  meetup: Meetup;
  onToggleLock?: (userId: string) => void;
  onReshuffle?: () => void;
  reshuffling?: boolean;
  substitutions?: SubstitutionsControls;
  currentUserId?: string;
  linkToPlayers?: boolean;
}) {
  return (
    <>
      <SkillBanner
        meetup={meetup}
        onReshuffle={onReshuffle}
        reshuffling={reshuffling}
        substitutions={substitutions}
      />
      {substitutions?.active && (
        <p role="status" className="mb-3 text-sm text-live">
          {substitutions.saving
            ? "Saving substitution…"
            : substitutions.selectedId
              ? "Choose a player on another team."
              : "Choose the first player to swap."}
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {meetup.teams.map((team, index) => (
          <TeamColumn
            key={team.id}
            team={team}
            index={index}
            players={team.players.map((player) => mergePlayerWithAttendance(meetup, player))}
            onToggleLock={onToggleLock}
            substitutions={substitutions}
            currentUserId={currentUserId}
            linkToPlayers={linkToPlayers}
          />
        ))}
      </div>
    </>
  );
}
