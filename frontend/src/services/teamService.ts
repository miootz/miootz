import type { User, Team } from '../types';

/** Matches backend `team_assignment.team_counts` */
export function teamCounts(total: number): number[] {
  if (total <= 0) return [];
  const nTeams = total <= 10 ? 2 : 3;
  const base = Math.floor(total / nTeams);
  const rem = total % nTeams;
  return Array.from({ length: nTeams }, (_, i) => base + (i < rem ? 1 : 0));
}

function assignSnakeWithCaps(players: User[], counts: number[]): Team[] {
  const nTeams = counts.length;
  const teams: Team[] = Array.from({ length: nTeams }, (_, i) => ({
    id: `t${i + 1}`,
    players: [] as User[],
  }));
  const sorted = [...players].sort((a, b) => b.skillScore - a.skillScore);
  sorted.forEach((player, i) => {
    const roundIdx = Math.floor(i / nTeams);
    const pos = i % nTeams;
    let tidx = roundIdx % 2 === 0 ? pos : nTeams - 1 - pos;
    let attempts = 0;
    while (teams[tidx].players.length >= counts[tidx] && attempts < nTeams) {
      tidx = (tidx + 1) % nTeams;
      attempts += 1;
    }
    teams[tidx].players.push(player);
  });
  return teams;
}

export const assignTeams = (players: User[]): Team[] => {
  const counts = teamCounts(players.length);
  if (counts.length === 0) return [];
  return assignSnakeWithCaps(players, counts);
};

export const rebalanceTeams = (currentSession: {
  attendance: User[];
  teams: Team[];
}): Team[] => {
  const lockedPlayersMap = new Map<string, { teamId: string; player: User }>();

  currentSession.teams.forEach((team) => {
    team.players.forEach((player) => {
      if (player.isLocked) {
        lockedPlayersMap.set(player.id, { teamId: team.id, player });
      }
    });
  });

  const unlockedPlayers = currentSession.attendance.filter((p) => !p.isLocked);
  const totalCount = currentSession.attendance.length;
  const counts = teamCounts(totalCount);
  const teamCount = counts.length;

  const teams: Team[] = Array.from({ length: teamCount }, (_, i) => ({
    id: `t${i + 1}`,
    players: [] as User[],
  }));

  lockedPlayersMap.forEach(({ teamId, player }) => {
    const tIdx = parseInt(teamId.replace('t', ''), 10) - 1;
    if (tIdx >= 0 && tIdx < teamCount) {
      teams[tIdx].players.push(player);
    } else {
      teams[0].players.push(player);
    }
  });

  const sortedUnlocked = [...unlockedPlayers].sort(
    (a, b) => b.skillScore - a.skillScore
  );
  sortedUnlocked.forEach((player) => {
    let best = 0;
    let minP = Infinity;
    for (let i = 0; i < teamCount; i++) {
      const cap = counts[i];
      const len = teams[i].players.length;
      if (len < cap && len < minP) {
        minP = len;
        best = i;
      }
    }
    for (let i = 0; i < teamCount; i++) {
      if (teams[i].players.length < counts[i]) {
        best = i;
        break;
      }
    }
    teams[best].players.push(player);
  });

  return teams;
};
