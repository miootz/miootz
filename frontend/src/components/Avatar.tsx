import { useState } from "react";
import { mediaUrl } from "../api/meApi";

export function Avatar({
  url,
  username,
  size = "sm",
}: {
  url?: string | null;
  username: string;
  size?: "sm" | "md";
}) {
  const sizeClasses = size === "md" ? "w-9 h-9 text-sm" : "w-7 h-7 text-xs";

  // Pocket ID media URLs can 404 (deleted/never-uploaded avatars). Fall back
  // to the initials tile when the image fails to load instead of showing a
  // broken image icon.
  const [failed, setFailed] = useState(false);

  const resolved = failed ? undefined : mediaUrl(url ?? undefined);
  if (resolved) {
    return (
      <img
        src={resolved}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={`${sizeClasses} border border-line object-cover flex-shrink-0`}
      />
    );
  }

  const initials = username
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={`${sizeClasses} border border-line bg-raised text-ink font-medium flex items-center justify-center flex-shrink-0 select-none`}
    >
      {initials}
    </div>
  );
}
