import {
  initialsFromName,
  skillBadgeClasses,
} from "../utils/playerDisplay";

type Size = "sm" | "md" | "lg";

const faceSize: Record<Size, string> = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-xs",
  lg: "w-12 h-12 text-sm",
};

const badgeSize: Record<Size, string> = {
  sm: "text-2xs px-1.5 py-0",
  md: "text-xs px-2 py-0.5",
  lg: "text-sm px-2.5 py-0.5",
};

export function SkillBadge({
  score,
  size = "md",
}: {
  score: number;
  size?: Size;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center font-semibold tabular-nums ${badgeSize[size]} ${skillBadgeClasses(score)}`}
      title={`Skill ${score}`}
    >
      {score}
    </span>
  );
}

export function PlayerAvatarFace({
  name,
  avatarUrl,
  size = "md",
  isPlusOne,
}: {
  name: string;
  avatarUrl?: string;
  size?: Size;
  isPlusOne?: boolean;
}) {
  const s = faceSize[size];

  if (isPlusOne) {
    return (
      <div
        className={`${s} shrink-0 flex items-center justify-center font-bold text-pink-400 bg-pink-500/20 border border-pink-500/50`}
        aria-hidden
      >
        +1
      </div>
    );
  }

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`${s} border border-line object-cover shrink-0 bg-raised`}
      />
    );
  }

  return (
    <div
      className={`${s} border border-line bg-raised text-ink shrink-0 flex items-center justify-center font-semibold`}
      aria-hidden
    >
      {initialsFromName(name)}
    </div>
  );
}
