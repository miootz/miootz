import { initialsFromName } from "../utils/playerDisplay";

type Size = "sm" | "md" | "lg";

const faceSize: Record<Size, string> = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-xs",
  lg: "w-12 h-12 text-sm",
};

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
