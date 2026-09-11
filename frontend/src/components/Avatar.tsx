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
        className={`${sizeClasses} rounded-full object-cover flex-shrink-0 ring-1 ring-gray-200 dark:ring-gray-700`}
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
      className={`${sizeClasses} rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-medium flex items-center justify-center flex-shrink-0 ring-1 ring-gray-200 dark:ring-gray-700 select-none`}
    >
      {initials}
    </div>
  );
}
