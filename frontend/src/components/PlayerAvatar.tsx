import {
  initialsFromName,
  playerAvatarColor,
  skillBadgeClasses,
} from '../utils/playerDisplay';

type Size = 'sm' | 'md';

const faceSize: Record<Size, string> = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-xs',
};

const badgeSize: Record<Size, string> = {
  sm: 'text-[10px] px-1.5 py-0',
  md: 'text-xs px-2 py-0.5',
};

export function SkillBadge({
  score,
  size = 'md',
}: {
  score: number;
  size?: Size;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-semibold tabular-nums ${badgeSize[size]} ${skillBadgeClasses(score)}`}
      title={`Skill ${score}`}
    >
      {score}
    </span>
  );
}

export function PlayerAvatarFace({
  name,
  avatarUrl,
  size = 'md',
}: {
  name: string;
  avatarUrl?: string;
  size?: Size;
}) {
  const s = faceSize[size];

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`${s} rounded-full object-cover shrink-0 bg-gray-200 dark:bg-gray-700`}
      />
    );
  }

  return (
    <div
      className={`${s} rounded-full shrink-0 flex items-center justify-center font-semibold text-white`}
      style={{ backgroundColor: playerAvatarColor(name) }}
      aria-hidden
    >
      {initialsFromName(name)}
    </div>
  );
}
