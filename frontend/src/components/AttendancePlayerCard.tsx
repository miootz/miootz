import React from "react";
import { PlayerAvatarFace, SkillBadge } from "./PlayerAvatar";

/*
 * Single source of UI truth for an attendance row at every breakpoint:
 * avatar, name, +1, positions, skill, status badge, calc-skill, actions.
 */

const SPECIALTY_LABELS: Record<string, string> = {
  ATT: "Attacker",
  MID: "Midfielder",
  DEF: "Defender",
  GK: "Goalkeeper",
};

function specialtyLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return SPECIALTY_LABELS[code] ?? code;
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-team-a/15 text-team-a",
  waitlisted: "bg-live/15 text-live",
  cancelled: "bg-raised text-ink-dim",
};

export const AttendancePlayerCard: React.FC<{
  name: string;
  avatarUrl?: string | null;
  skill: number;
  primary?: string | null;
  secondary?: string | null;
  isPlusOne?: boolean;
  status: string;
  calculatedSkill?: number | null;
  action?: React.ReactNode;
}> = ({
  name,
  avatarUrl,
  skill,
  primary,
  secondary,
  isPlusOne,
  status,
  calculatedSkill,
  action,
}) => {
  const posLabel =
    [specialtyLabel(primary), specialtyLabel(secondary)]
      .filter(Boolean)
      .join("/") || null;
  const mmSkill = Math.min(5, Math.max(1, Math.round(skill)));

  return (
    <div className="border border-line bg-panel p-3 transition-colors">
      <div className="flex items-center gap-2.5">
        <PlayerAvatarFace
          name={name}
          avatarUrl={avatarUrl ?? undefined}
          size="sm"
          isPlusOne={isPlusOne}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-ink truncate">
              {name}
            </span>
            {isPlusOne && (
              <span className="shrink-0 bg-pink-500/15 px-1.5 py-0.5 text-2xs font-medium text-pink-400">
                +1
              </span>
            )}
            {posLabel && (
              <span className="shrink-0 text-2xs font-medium text-ink-dim bg-raised px-1.5 py-0.5">
                {posLabel}
              </span>
            )}
            <SkillBadge score={mmSkill} size="sm" />
            <span
              className={`shrink-0 px-2 py-0.5 text-2xs font-medium ${
                STATUS_STYLES[status] ?? STATUS_STYLES.cancelled
              }`}
            >
              {status}
            </span>
          </div>
          {calculatedSkill != null && (
            <div className="text-2xs text-ink-faint mt-0.5">
              calc {calculatedSkill}
            </div>
          )}
        </div>
        {action}
      </div>
    </div>
  );
};
