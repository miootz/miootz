import { describe, expect, it } from "vitest";
import type { MatchSummary } from "../api/matchesApi";
import type { TeamsResponse } from "../api/meetupsApi";
import { computeInheritedLineups } from "../utils/inheritedLineups";

const teams: TeamsResponse["teams"] = [
  {
    id: "t1",
    name: "Team A",
    players: [
      { id: "1", name: "Alice", skillScore: 3, isLocked: false },
      { id: "2", name: "Bob", skillScore: 3, isLocked: false },
    ],
  },
  {
    id: "t2",
    name: "Team B",
    players: [
      { id: "3", name: "Cara", skillScore: 3, isLocked: false },
      { id: "4", name: "Dan", skillScore: 3, isLocked: false },
    ],
  },
  {
    id: "t3",
    name: "Team C",
    players: [{ id: "5", name: "Eve", skillScore: 3, isLocked: false }],
  },
];

function match(overrides: Partial<MatchSummary>): MatchSummary {
  return {
    id: 1,
    meetup_id: 7,
    match_number: 1,
    team_a: { name: "Team A", users: [{ id: 1, display_name: "Alice", avatar_url: null }] },
    team_b: { name: "Team B", users: [{ id: 3, display_name: "Cara", avatar_url: null }] },
    score_a: 0,
    score_b: 0,
    status: "completed",
    timer_total_seconds: 0,
    timer_seconds_remaining: 0,
    timer_paused: false,
    created_at: null,
    completed_at: null,
    ...overrides,
  } as MatchSummary;
}

describe("computeInheritedLineups", () => {
  it("uses the original team lists when neither team has played yet", () => {
    const result = computeInheritedLineups(teams, [], "Team A", "Team B");
    expect(result.teamA.matchNumber).toBeNull();
    expect(result.teamB.matchNumber).toBeNull();
    expect(result.teamA.players).toEqual([1, 2]);
    expect(result.teamB.players).toEqual([3, 4]);
  });

  it("inherits each team from its own last match", () => {
    // Team A played in match 1; Team B only in match 2 (not together).
    const existing = [
      match({
        match_number: 1,
        team_a: { name: "Team A", users: [{ id: 1, display_name: "Alice", avatar_url: null }, { id: 2, display_name: "Bob", avatar_url: null }] },
        team_b: { name: "Team C", users: [{ id: 5, display_name: "Eve", avatar_url: null }] },
      }),
      match({
        match_number: 2,
        team_a: { name: "Team B", users: [{ id: 3, display_name: "Cara", avatar_url: null }, { id: 4, display_name: "Dan", avatar_url: null }] },
        team_b: { name: "Team C", users: [{ id: 5, display_name: "Eve", avatar_url: null }] },
      }),
    ];
    const result = computeInheritedLineups(teams, existing, "Team A", "Team B");
    expect(result.teamA.matchNumber).toBe(1);
    expect(result.teamA.players).toEqual([1, 2]);
    expect(result.teamB.matchNumber).toBe(2);
    expect(result.teamB.players).toEqual([3, 4]);
  });

  it("uses the latest match for each team independently", () => {
    const existing = [
      match({
        match_number: 1,
        team_a: { name: "Team A", users: [{ id: 1, display_name: "Alice", avatar_url: null }] },
        team_b: { name: "Team B", users: [{ id: 3, display_name: "Cara", avatar_url: null }] },
      }),
      match({
        match_number: 2,
        team_a: { name: "Team B", users: [{ id: 4, display_name: "Dan", avatar_url: null }] },
        team_b: { name: "Team A", users: [{ id: 2, display_name: "Bob", avatar_url: null }] },
      }),
    ];
    const result = computeInheritedLineups(teams, existing, "Team A", "Team B");
    expect(result.teamA.matchNumber).toBe(2);
    expect(result.teamA.players).toEqual([2]);
    expect(result.teamB.matchNumber).toBe(2);
    expect(result.teamB.players).toEqual([4]);
  });

  it("falls back to the original team list for a team that has not played", () => {
    const existing = [
      match({
        match_number: 1,
        team_a: { name: "Team A", users: [{ id: 1, display_name: "Alice", avatar_url: null }] },
        team_b: { name: "Team C", users: [{ id: 5, display_name: "Eve", avatar_url: null }] },
      }),
    ];
    const result = computeInheritedLineups(teams, existing, "Team A", "Team B");
    expect(result.teamA.matchNumber).toBe(1);
    expect(result.teamA.players).toEqual([1]);
    expect(result.teamB.matchNumber).toBeNull();
    expect(result.teamB.players).toEqual([3, 4]);
  });
});
