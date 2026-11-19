import { useId } from "react";
import type { PeerReview } from "../api/ratingsApi";

const REVIEWS: { value: PeerReview; label: string; emoji: string }[] = [
  { value: "poorly", label: "poor", emoji: "😥" },
  { value: "expected", label: "okay", emoji: "😐" },
  { value: "well", label: "good", emoji: "😏" },
  { value: "excellent", label: "great", emoji: "🤩" },
];

export function PeerReviewControl({
  value,
  onChange,
  playerName,
}: {
  value: PeerReview | null;
  onChange?: (review: PeerReview | null) => void;
  playerName: string;
}) {
  const instructionsId = useId();
  return (
    <div
      role="group"
      aria-label={`Your review of ${playerName}`}
      aria-describedby={instructionsId}
      className="inline-flex gap-1"
    >
      <span id={instructionsId} className="sr-only">
        {value == null
          ? "Okay is selected by default. Select a review to save it."
          : "Activate the selected review again to clear it."}
      </span>
      {REVIEWS.map((review) => {
        const selected = (value ?? "expected") === review.value;
        return (
          <button
            key={review.value}
            type="button"
            aria-label={review.label}
            aria-pressed={selected}
            title={value === review.value ? `${review.label} — activate again to clear` : review.label}
            onClick={() => onChange?.(value === review.value ? null : review.value)}
            className={`flex min-h-14 w-11 flex-col items-center justify-center gap-0.5 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-live ${
              selected
                ? value == null ? "bg-live/10" : "bg-live/20"
                : "hover:bg-raised"
            }`}
          >
            <span className="text-xl leading-none" aria-hidden="true">{review.emoji}</span>
            <span className="text-2xs leading-none text-ink-dim">{review.label}</span>
          </button>
        );
      })}
    </div>
  );
}
