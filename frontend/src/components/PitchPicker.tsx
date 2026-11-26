import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMeetupMatches, type MatchSummary } from "../api/matchesApi";
import { roomPath } from "../utils/demoRoom";
import { ChevronRight } from "lucide-react";

/**
 * Pitch picker for the meetup overview: one button per pitch, linking to the
 * referee view for that pitch's match. Two refs can work the two pitches
 * independently; the referee exits the referee view and picks the other pitch
 * here.
 */
export function PitchPicker({ meetupId }: { meetupId: number }) {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchMeetupMatches(meetupId);
        if (!cancelled) {
          setMatches(res.matches);
          setLoaded(true);
        }
      } catch {
        // Keep the last snapshot; the picker is a navigation aid.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetupId]);

  if (!loaded || matches.length === 0) return null;

  // The pitch for a match: round-1 matches sit on pitch 1/2 in order, and
  // every later round reuses the two pitches in the same order.
  const pitchOf = (m: MatchSummary) => ((m.match_number - 1) % 2) + 1;

  const pitches = new Map<number, MatchSummary[]>();
  for (const m of matches) {
    const p = pitchOf(m);
    const list = pitches.get(p) ?? [];
    list.push(m);
    pitches.set(p, list);
  }

  // Pitches used by the existing matches; before kickoff, show the two
  // pitches this meetup targets.
  const pitchNumbers = matches.length === 0
    ? [1, 2]
    : Array.from(new Set(matches.map(pitchOf))).sort((a, b) => a - b);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {pitchNumbers.map((pitch) => {
        const pitchMatches = (pitches.get(pitch) ?? []).filter(
          (m) => m.status !== "completed",
        );
        const current = pitchMatches[0];
        const anyMatch = (pitches.get(pitch) ?? []).length > 0;

        if (current) {
          return (
            <Link
              key={pitch}
              to={roomPath(`/meetup-matches/${meetupId}/${current.id}`)}
              className="flex items-center gap-3 border border-line bg-panel px-4 py-3 text-left hover:bg-raised active:scale-[0.99] transition-transform"
            >
              <div className="min-w-0 flex-1">
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                  Pitch {pitch}
                </p>
                <p className="truncate text-sm font-semibold text-ink">
                  {current.team_a.name} vs {current.team_b.name}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            </Link>
          );
        }

        return (
          <Link
            key={pitch}
            to={roomPath(`/meetup-matches/${meetupId}`)}
            className="flex items-center gap-3 border border-dashed border-line px-4 py-3 text-left text-ink-dim hover:bg-raised active:scale-[0.99] transition-transform"
          >
            <div className="min-w-0 flex-1">
              <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                Pitch {pitch}
              </p>
              <p className="text-sm font-semibold text-ink-dim">
                {anyMatch ? "Pitch free — start next match" : "Start match"}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}
