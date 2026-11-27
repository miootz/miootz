import { Link } from "react-router-dom";
import type { MatchSummary } from "../api/matchesApi";
import { ChevronRight } from "lucide-react";

/**
 * Pitch picker for the meetup overview: one button per pitch, linking to the
 * referee view for that pitch's match. Two refs can work the two pitches
 * independently; the referee exits the referee view and picks the other pitch
 * here.
 */
export function PitchPicker({ meetupId, matches }: { meetupId: number; matches: MatchSummary[] }) {
  const active = matches.filter((m) => m.status !== "completed" || (
    m.match_number === 1 && m.score_a === m.score_b && !m.penalty_winner && !m.penalty_skipped
  ));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {[1, 2].map((pitch) => {
        const current = active.find((m) => (m.pitch ?? 1) === pitch);
        const previous = matches.some((m) => (m.pitch ?? 1) === pitch);
        return (
          <Link
            key={pitch}
            to={`/meetup-matches/${meetupId}?pitch=${pitch}`}
            className="flex items-center gap-3 border border-line bg-panel px-4 py-3 text-left hover:bg-raised active:scale-[0.99] transition-transform"
          >
            <div className="min-w-0 flex-1">
              <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                Pitch {pitch}
              </p>
              <p className="truncate text-sm font-semibold text-ink">
                {current ? `${current.team_a.name} vs ${current.team_b.name}` : previous ? "Open referee" : "Create match"}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}
