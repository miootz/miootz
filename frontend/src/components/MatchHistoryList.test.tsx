import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MatchHistoryList } from "./MatchHistoryList";
import { AuthContext } from "../auth/auth-context";
import type { MatchSummary } from "../api/matchesApi";
import type { PenaltyMissRow } from "../api/stewardApi";

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../api/matchesApi", async (original) => ({
  ...await original<typeof import("../api/matchesApi")>(),
  fetchMeetupMatches: vi.fn(),
  fetchMatchSubstitutions: vi.fn(),
  setScores: vi.fn(),
  createMatch: vi.fn(),
  deleteMatch: vi.fn(),
}));
vi.mock("../api/stewardApi", async (original) => ({
  ...await original<typeof import("../api/stewardApi")>(),
  fetchGoals: vi.fn(),
  fetchPenaltyMisses: vi.fn(),
  deletePenaltyMiss: vi.fn(),
}));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast }) }));

import { fetchMeetupMatches, fetchMatchSubstitutions } from "../api/matchesApi";
import { fetchGoals, fetchPenaltyMisses, deletePenaltyMiss } from "../api/stewardApi";

const fetchMatches = vi.mocked(fetchMeetupMatches);
const fetchSubs = vi.mocked(fetchMatchSubstitutions);
const fetchGoalsMock = vi.mocked(fetchGoals);
const fetchMisses = vi.mocked(fetchPenaltyMisses);
const deleteMiss = vi.mocked(deletePenaltyMiss);

const match: MatchSummary = {
  id: 10,
  meetup_id: 1,
  match_number: 1,
  team_a: { name: "Blue", users: [{ id: 1, display_name: "P1", avatar_url: null }] },
  team_b: { name: "Gold", users: [{ id: 2, display_name: "P2", avatar_url: null }] },
  score_a: 1,
  score_b: 1,
  was_draw: true,
  penalty_winner: "a",
  penalty_score_a: 4,
  penalty_score_b: 3,
  status: "completed",
  timer_total_seconds: 600,
  timer_seconds_remaining: 0,
  timer_paused: false,
  created_at: null,
  completed_at: "2026-11-26T10:00:00Z",
};

const miss: PenaltyMissRow = {
  id: 7,
  team: "a",
  clock_minute: 9,
  scorer: { id: 1, display_name: "P1", avatar_url: null },
  created_at: "2026-11-26T10:00:00Z",
};

const adminAuth = {
  me: { id: 9, display_name: "Admin", is_admin: true, avatar_url: null },
  loading: false,
  error: null,
  tokens: null,
  refresh: vi.fn(),
  savePosition: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
} as never;

const renderList = () =>
  render(
    <MemoryRouter>
      <AuthContext.Provider value={adminAuth}>
        <MatchHistoryList meetupId={1} editable />
      </AuthContext.Provider>
    </MemoryRouter>,
  );

describe("MatchHistoryList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMatches.mockResolvedValue({ matches: [match], match_duration_minutes: 10 });
    fetchSubs.mockResolvedValue({ substitutions: [] });
    fetchGoalsMock.mockResolvedValue([]);
    fetchMisses.mockResolvedValue([miss]);
    deleteMiss.mockResolvedValue(undefined as never);
  });

  it("shows the shootout result and the penalty misses when expanded", async () => {
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: /Match 1/ }));
    expect(await screen.findByText(/Shootout: 4 – 3/)).toBeInTheDocument();
    expect(await screen.findByText("Penalty misses")).toBeInTheDocument();
    expect(screen.getByText(/P1 \(miss\)/)).toBeInTheDocument();
  });

  it("deletes a miss and removes it from the list", async () => {
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: /Match 1/ }));
    await screen.findByText("Penalty misses");
    fireEvent.click(screen.getByRole("button", { name: "Delete penalty miss by P1" }));
    await waitFor(() => expect(deleteMiss).toHaveBeenCalledWith(1, 10, 7));
    await waitFor(() =>
      expect(screen.queryByText("Penalty misses")).not.toBeInTheDocument(),
    );
  });
});
