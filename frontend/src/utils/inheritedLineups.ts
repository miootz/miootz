import type { MatchSummary } from "../api/matchesApi";
import type { TeamsResponse } from "../api/meetupsApi";

export interface TeamLineupInheritance {
  players: number[];
  /** Match number the lineup was inherited from; null = the original team list. */
  matchNumber: number | null;
}

export interface InheritedLineups {
  teamA: TeamLineupInheritance;
  teamB: TeamLineupInheritance;
}

/**
 * Inherit the starting lineups for the selected teams: from the last match
 * each team played in the meetup, or from the meetup's original team lists when
 * the team has not played yet.
 */
export function computeInheritedLineups(
  teams: TeamsResponse["teams"],
  existingMatches: MatchSummary[],
  teamAName: string,
  teamBName: string,
): InheritedLineups {
  const lastMatchFor = (teamName: string) => {
    const n = teamName.trim().toLowerCase();
    for (let i = existingMatches.length - 1; i >= 0; i--) {
      const m = existingMatches[i];
      if (m.team_a.name.toLowerCase() === n || m.team_b.name.toLowerCase() === n) return m;
    }
    return null;
  };

  const lineupFor = (match: MatchSummary, teamName: string) => {
    const n = teamName.trim().toLowerCase();
    const side = match.team_a.name.toLowerCase() === n ? match.team_a : match.team_b;
    return side.users.map((u) => u.id);
  };

  const originalFor = (teamName: string) => {
    const n = teamName.trim().toLowerCase();
    return (teams.find((t) => t.name.toLowerCase() === n)?.players ?? []).map((p) => Number(p.id));
  };

  const inherit = (teamName: string): TeamLineupInheritance => {
    const match = lastMatchFor(teamName);
    if (match) return { players: lineupFor(match, teamName), matchNumber: match.match_number };
    return { players: originalFor(teamName), matchNumber: null };
  };

  return { teamA: inherit(teamAName), teamB: inherit(teamBName) };
}
