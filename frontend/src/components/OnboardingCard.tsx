import { useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";

export const SKILL_SCALE_BLURB = "1 = brand new · 5 = very experienced";

const STEPS = [
  {
    title: "Join the next meetup",
    body: "When signups open for the next session, join from the Meetup page. If it's full, you'll land on the waitlist with your position shown.",
  },
  {
    title: "Get balanced into teams",
    body: `Before each session we balance teams using your self-assessed skill (${SKILL_SCALE_BLURB.toLowerCase()}).`,
  },
  {
    title: "Rate your teammates",
    body: "After the session, rate your teammates on a 1–5 scale. Ratings keep future team-balancing fair.",
  },
];

function storageKey(userId: string) {
  return `miootz:onboarding:v1:${userId}`;
}

/**
 * Dismissible 3-step onboarding card for first-time players.
 * Dismissal is stored per user in localStorage.
 */
export function OnboardingCard({ userId }: { userId: string }) {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey(userId)) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const persistDismissed = () => {
    try {
      localStorage.setItem(storageKey(userId), "1");
    } catch {
      // private mode etc. — card just reappears next visit
    }
    setDismissed(true);
  };

  const stepData = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="rounded-2xl border border-violet-200 dark:border-violet-900/60 bg-violet-50 dark:bg-violet-950/30 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            New to Miootz? · Step {step + 1} of {STEPS.length}
          </p>
          <h3 className="mt-1 text-base font-bold text-gray-900 dark:text-white">
            {stepData.title}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {stepData.body}
          </p>
        </div>
        <button
          type="button"
          onClick={persistDismissed}
          className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-violet-100 hover:text-gray-600 dark:hover:bg-violet-900/50 dark:hover:text-gray-300"
          aria-label="Dismiss onboarding"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s.title}
              className={`h-1.5 w-6 rounded-full ${
                i <= step ? "bg-violet-500" : "bg-violet-200 dark:bg-violet-900"
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => (isLast ? persistDismissed() : setStep(step + 1))}
          className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 active:scale-[0.98]"
        >
          {isLast ? (
            <>
              Done <Check className="h-4 w-4" />
            </>
          ) : (
            <>
              Next <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
