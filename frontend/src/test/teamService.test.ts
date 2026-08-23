import { describe, it, expect } from 'vitest';
import { assignTeams, rebalanceTeams } from '../services/teamService';
import type { User } from '../types';

describe('Team Assignment Logic', () => {
  const mockPlayers: User[] = [
    { id: '1', name: 'P1', skillScore: 100, isLocked: false },
    { id: '2', name: 'P2', skillScore: 90, isLocked: false },
    { id: '3', name: 'P3', skillScore: 80, isLocked: false },
    { id: '4', name: 'P4', skillScore: 70, isLocked: false },
    { id: '5', name: 'P5', skillScore: 60, isLocked: false },
    { id: '6', name: 'P6', skillScore: 50, isLocked: false },
    { id: '7', name: 'P7', skillScore: 40, isLocked: false },
    { id: '8', name: 'P8', skillScore: 30, isLocked: false },
    { id: '9', name: 'P9', skillScore: 20, isLocked: false },
    { id: '10', name: 'P10', skillScore: 10, isLocked: false },
  ];

  it('should assign 10 players into 2 teams of 5', () => {
    const teams = assignTeams(mockPlayers);
    expect(teams).toHaveLength(2);
    expect(teams[0].players).toHaveLength(5);
    expect(teams[1].players).toHaveLength(5);
  });

  it('should assign 12 players into 3 teams of 4', () => {
    const twelvePlayers = [...mockPlayers, 
      { id: '11', name: 'P11', skillScore: 5, isLocked: false },
      { id: '12', name: 'P12', skillScore: 4, isLocked: false }
    ];
    const teams = assignTeams(twelvePlayers);
    expect(teams).toHaveLength(3);
    expect(teams[0].players).toHaveLength(4);
  });

  it('should respect locked players during rebalance', () => {
    const attendance = [
      { id: '1', name: 'P1', skillScore: 100, isLocked: true }, // Locked to Team 1
      { id: '2', name: 'P2', skillScore: 90, isLocked: false },
    ];
    const teams = [
      { id: 't1', name: 'Team 1', players: [attendance[0]] },
      { id: 't2', name: 'Team 2', players: [attendance[1]] },
    ];

    const rebalanced = rebalanceTeams({ attendance, teams });
    const team1 = rebalanced.find(t => t.id === 't1');
    expect(team1?.players.some(p => p.id === '1')).toBe(true);
  });

  it('should use attendance for lock state when team roster copy is stale', () => {
    const attendance = [
      { id: '1', name: 'P1', skillScore: 100, isLocked: true },
      { id: '2', name: 'P2', skillScore: 90, isLocked: false },
    ];
    const teams = [
      {
        id: 't1',
        name: 'Team 1',
        players: [{ id: '1', name: 'P1', skillScore: 100, isLocked: false }],
      },
      { id: 't2', name: 'Team 2', players: [attendance[1]] },
    ];

    const rebalanced = rebalanceTeams({ attendance, teams });
    const team1 = rebalanced.find((t) => t.id === 't1');
    expect(team1?.players.some((p) => p.id === '1')).toBe(true);
  });
});
