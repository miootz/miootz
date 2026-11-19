import { useId } from "react";
import type { PeerReview } from "../api/ratingsApi";

const REVIEWS: { value: PeerReview; label: string; emoji: string }[] = [
  { value: "poorly", label: "Poorly", emoji: "👎" },
  { value: "expected", label: "As expected", emoji: "👌" },
  { value: "well", label: "Well", emoji: "👍" },
  { value: "excellent", label: "Excellent", emoji: "👏" },
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
          ? "As expected is selected by default. Select a review to save it."
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
            className={`grid h-11 w-11 place-items-center border text-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-live ${
              selected
                ? value == null ? "border-live/60 bg-live/5" : "border-live bg-live/20"
                : "border-line bg-raised hover:border-live/60"
            }`}
          >
            <span aria-hidden="true">{review.emoji}</span>
          </button>
        );
      })}
    </div>
  );
}
