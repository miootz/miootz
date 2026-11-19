import { useRef, useState, type CSSProperties } from 'react';
import { Star, X } from 'lucide-react';

interface StarRatingProps {
  value: number | null;
  onChange?: (value: number) => void;
  onClear?: () => void;
  size?: number;
  readonly?: boolean;
  disabled?: boolean;
  label?: string;
  min?: number;
}

export function StarRating({
  value,
  onChange,
  onClear,
  size = 24,
  readonly = false,
  disabled = false,
  label = 'Rating',
  min = 0.5,
}: StarRatingProps) {
  const interactive = !readonly && !!onChange;
  const [preview, setPreview] = useState<number | null>(null);
  const dragging = useRef(false);
  const current = preview ?? value;
  const targetSize = Math.max(size, 24);

  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
      {interactive && (
        <button
          type="button"
          disabled={disabled || value == null}
          onClick={() => onClear ? onClear() : onChange(0)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center text-ink-faint hover:text-live disabled:opacity-40"
          aria-label={`Clear ${label}`}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
      <span className="relative inline-flex focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-live">
        {[1, 2, 3, 4, 5].map((n) => {
          const frac = Math.max(0, Math.min(1, (current ?? 0) - (n - 1)));
          return (
            <span key={n} className="inline-flex min-h-11 items-center justify-center" style={{ width: targetSize }} aria-hidden="true">
              <span className="relative inline-block text-ink-faint" style={{ width: size, height: size }}>
                <Star width={size} height={size} fill="none" strokeWidth={1.5} />
                {frac > 0 && (
                  <span className="absolute inset-0 overflow-hidden text-live" style={{ width: `${frac * 100}%` }}>
                    <Star width={size} height={size} fill="currentColor" strokeWidth={1.5} />
                  </span>
                )}
              </span>
            </span>
          );
        })}
        {interactive && (
          <input
            type="range"
            min="0.5"
            max="5"
            step="0.5"
            disabled={disabled}
            value={Math.max(0.5, Math.min(5, Math.round((current ?? 0.5) * 2) / 2))}
            aria-label={label}
            aria-valuemin={value === 0 ? 0 : min}
            aria-valuenow={current ?? min}
            aria-valuetext={current == null ? 'Not rated' : `${current} out of 5 stars`}
            onPointerDown={(event) => {
              dragging.current = true;
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerUp={(event) => {
              if (!dragging.current) return;
              dragging.current = false;
              const next = Math.max(min, event.currentTarget.valueAsNumber);
              setPreview(null);
              if (next !== value) onChange(next);
            }}
            onPointerCancel={() => {
              dragging.current = false;
              setPreview(null);
            }}
            onKeyDown={(event) => {
              if ((value == null || value < min) && ['Home', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                onChange(min);
              } else if (value != null && !Number.isInteger(value * 2) && ['ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                const up = event.key === 'ArrowUp' || event.key === 'ArrowRight';
                onChange(Math.max(min, (up ? Math.ceil(value * 2) : Math.floor(value * 2)) / 2));
              }
            }}
            onChange={(event) => {
              const next = Math.max(min, event.currentTarget.valueAsNumber);
              if (dragging.current) setPreview(next);
              else onChange(next);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 [&::-webkit-slider-thumb]:w-[var(--star-half-size)] [&::-webkit-slider-thumb]:appearance-none [&::-moz-range-thumb]:w-[var(--star-half-size)] [&::-moz-range-thumb]:border-0"
            style={{ '--star-half-size': `${targetSize / 2}px` } as CSSProperties}
          />
        )}
      </span>
      <span className="text-xs tabular-nums text-ink-dim">{current == null ? 'Not rated' : `${current} / 5`}</span>
    </div>
  );
}
