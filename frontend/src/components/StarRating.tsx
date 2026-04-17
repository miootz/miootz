import { Star } from 'lucide-react';

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  readonly?: boolean;
}

export function StarRating({
  value,
  onChange,
  size = 24,
  readonly = false,
}: StarRatingProps) {
  return (
    <div className="inline-flex gap-0.5" role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readonly || !onChange}
          onClick={() => onChange?.(n)}
          className={`${onChange && !readonly ? 'cursor-pointer' : 'cursor-default'} transition-colors ${
            n <= value
              ? 'text-yellow-400'
              : 'text-gray-300 dark:text-gray-600'
          } hover:text-yellow-400 disabled:text-gray-300 dark:disabled:text-gray-600`}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          aria-pressed={n <= value}
        >
          <Star
            width={size}
            height={size}
            fill={n <= value ? 'currentColor' : 'none'}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  );
}
