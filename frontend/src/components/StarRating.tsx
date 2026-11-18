import { Star, X } from 'lucide-react';

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  readonly?: boolean;
  /** Accessible name for the rating group. */
  label?: string;
  /** Allow .5 increments — click the left half of a star for n.5 (admin skill seeding). */
  halfSteps?: boolean;
  /** Allow an existing rating to be cleared. */
  clearable?: boolean;
}

export function StarRating({
  value,
  onChange,
  size = 24,
  readonly = false,
  label = 'Rating',
  halfSteps = false,
  clearable = false,
}: StarRatingProps) {
  const interactive = !readonly && !!onChange;
  return (
    <div className="inline-flex gap-0.5" role="group" aria-label={label}>
      {clearable && (
        <button
          type="button"
          disabled={!interactive || value <= 0}
          onClick={() => onChange?.(0)}
          className="inline-flex min-h-6 min-w-6 items-center justify-center text-ink-faint hover:text-live disabled:opacity-40"
          aria-label={`Clear ${label}`}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
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
            className={`${clearable ? 'inline-flex min-h-6 min-w-6 items-center justify-center ' : ''}${interactive ? 'cursor-pointer' : 'cursor-default'} transition-colors hover:text-live disabled:text-ink-faint`}
            aria-label={`${halfSteps ? `${n - 0.5} / ${n}` : n} star${n > 1 ? 's' : ''}${clearable ? `, ${label}` : ''}`}
            aria-pressed={clearable ? n === value : n <= value}
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
