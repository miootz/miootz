import { Star } from 'lucide-react';

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  readonly?: boolean;
  /** Accessible name for the rating group. */
  label?: string;
  /** Allow .5 increments — click the left half of a star for n.5 (admin skill seeding). */
  halfSteps?: boolean;
}

export function StarRating({
  value,
  onChange,
  size = 24,
  readonly = false,
  label = 'Rating',
  halfSteps = false,
}: StarRatingProps) {
  const interactive = !readonly && !!onChange;
  return (
    <div className="inline-flex gap-0.5" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => {
        // Filled fraction for this star: 1 full, 0.5 half, 0 empty.
        const frac = Math.max(0, Math.min(1, value - (n - 1)));
        return (
          <button
            key={n}
            type="button"
            disabled={!interactive}
            onClick={(e) => {
              if (!interactive) return;
              if (halfSteps) {
                const rect = e.currentTarget.getBoundingClientRect();
                const leftHalf = e.clientX - rect.left < rect.width / 2;
                onChange?.(leftHalf ? n - 0.5 : n);
              } else {
                onChange?.(n);
              }
            }}
            className={`${interactive ? 'cursor-pointer' : 'cursor-default'} transition-colors hover:text-live disabled:text-ink-faint`}
            aria-label={`${halfSteps ? `${n - 0.5} / ${n}` : n} star${n > 1 ? 's' : ''}`}
            aria-pressed={n <= value}
          >
            <span
              className="relative inline-block text-ink-faint"
              style={{ width: size, height: size }}
            >
              <Star width={size} height={size} fill="none" strokeWidth={1.5} />
              {frac > 0 && (
                <span
                  className="absolute inset-0 overflow-hidden text-live"
                  style={{ width: `${frac * 100}%` }}
                >
                  <Star
                    width={size}
                    height={size}
                    fill="currentColor"
                    strokeWidth={1.5}
                  />
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
