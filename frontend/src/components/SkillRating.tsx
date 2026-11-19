import { Star } from "lucide-react";

export function RatingStar({ className = "" }: { className?: string }) {
  return <Star className={`size-[0.85em] shrink-0 text-ink-dim ${className}`} aria-hidden />;
}

export function SkillRating({ score, className = "" }: {
  score?: number | null;
  className?: string;
}) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-bold tabular-nums ${className}`}>
      {score == null ? "—" : (
        <>
          <RatingStar />
          {score.toFixed(1)}
          <span className="sr-only"> stars</span>
        </>
      )}
    </span>
  );
}
