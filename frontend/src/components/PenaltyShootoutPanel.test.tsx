import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PenaltyShootoutPanel } from "./PenaltyShootoutPanel";
import type { MatchSummary, PenaltyState } from "../api/matchesApi";

const { showToast } = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

vi.mock("../api/matchesApi", async (original) => ({
  ...await original<typeof import("../api/matchesApi")>(),
  fetchPenalty: vi.fn(),
  finishPenaltyShootout: vi.fn(),
  addPenaltyShot: vi.fn(),
  undoPenaltyShot: vi.fn(),
}));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast }) }));

import { fetchPenalty as fetchPenaltyMock, finishPenaltyShootout as finishMock } from "../api/matchesApi";

const fetchPenaltyAsync = vi.mocked(fetchPenaltyMock);
const finishMockAsync = vi.mocked(finishMock);

const match: MatchSummary = {
  id: 10,
  meetup_id: 1,
  match_number: 1,
  team_a: { name: "Blue", users: [{ id: 1, display_name: "P1", avatar_url: null }] },
  team_b: { name: "Gold", users: [{ id: 2, display_name: "P2", avatar_url: null }] },
  score_a: 1,
  score_b: 1,
  status: "active",
  timer_total_seconds: 600,
  timer_seconds_remaining: 600,
  timer_paused: false,
  created_at: null,
  completed_at: null,
};

const decidedState: PenaltyState = {
  available: true,
  winner: null,
  shots: [
    { id: 1, team: "a", scorer: { id: 1, display_name: "P1", avatar_url: null }, scored: true },
    { id: 2, team: "b", scorer: { id: 2, display_name: "P2", avatar_url: null }, scored: false },
  ],
  counts: { a: 1, b: 0 },
  decided: true,
};

describe("PenaltyShootoutPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPenaltyAsync.mockResolvedValue(decidedState);
    finishMockAsync.mockResolvedValue({ winner: "a", match: match });
  });

  it("keeps the result on screen after finishing, with a Done button", async () => {
    const onFinished = vi.fn();
    render(<PenaltyShootoutPanel meetupId={1} match={match} onFinished={onFinished} />);

    const confirm = await screen.findByRole("button", { name: "Confirm winner" });
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.getByText(/Blue wins the shootout/)).toBeInTheDocument());
    expect(finishMockAsync).toHaveBeenCalledWith(1, 10);
    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    expect(screen.getByText("1 – 0")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("hides the Confirm winner button until the shootout is decided", async () => {
    fetchPenaltyAsync.mockResolvedValue({ ...decidedState, decided: false });
    render(<PenaltyShootoutPanel meetupId={1} match={match} onFinished={() => {}} />);
    await screen.findByText("Gold shoots — who takes it?");
    expect(screen.queryByRole("button", { name: "Confirm winner" })).not.toBeInTheDocument();
  });
});
