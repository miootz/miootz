import React from "react";
import { CheckCircle2, Hourglass } from "lucide-react";
import { PlayerAvatarFace } from "./PlayerAvatar";
import { SkillRating } from "./TeamPlayerCard";

/*
 * Single source of UI truth for an attendance row at every breakpoint:
 * avatar (spans both rows), name + status icon on top, positions +
 * computed star rating below, action button (spans rows).
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

const STATUS_ICONS: Record<
  string,
  { icon: React.ReactNode; label: string; className: string }
> = {
  confirmed: {
    icon: <CheckCircle2 className="w-4 h-4" />,
    label: "Confirmed",
    className: "text-team-a",
  },
  waitlisted: {
    icon: <Hourglass className="w-4 h-4" />,
    label: "Waitlisted",
    className: "text-live",
  },
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
  const statusIcon = STATUS_ICONS[status] ?? null;

  return (
    <div className="border border-line bg-panel p-3 transition-colors flex items-center gap-2.5">
      {/* Avatar — spans both rows */}
      <PlayerAvatarFace
        name={name}
        avatarUrl={avatarUrl ?? undefined}
        size="sm"
        isPlusOne={isPlusOne}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="min-w-0 text-sm font-medium text-ink truncate">
            {name}
          </span>
          {statusIcon && (
            <span
              className={`shrink-0 ${statusIcon.className}`}
              title={statusIcon.label}
              aria-label={statusIcon.label}
            >
              {statusIcon.icon}
            </span>
          )}
          {isPlusOne && (
            <span className="shrink-0 bg-pink-500/15 px-1.5 py-0.5 text-2xs font-medium text-pink-400">
              +1
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
          {posLabel && (
            <span className="min-w-0 text-2xs text-ink-faint truncate">
              {posLabel}
            </span>
          )}
          <SkillRating calculated={calculatedSkill} raw={skill} />
        </div>
      </div>
      {/* Action — spans both rows */}
      {action}
    </div>
  );
};
