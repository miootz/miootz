import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalEntrySheet } from "./GoalEntrySheet";
import type { MatchSummary } from "../api/matchesApi";

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../api/stewardApi", async (original) => ({
  ...await original<typeof import("../api/stewardApi")>(),
  acquireLease: vi.fn(),
  releaseLease: vi.fn(),
  renewLease: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
}));
vi.mock("../api/meetupsApi", async (original) => ({
  ...await original<typeof import("../api/meetupsApi")>(),
  fetchMeetupDetail: vi.fn(),
}));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast }) }));
// PlayerSelect → simple button that picks the first option (keeps the
// sheet's own logic under test, not the dropdown widget).
vi.mock("./PlayerSelect", () => ({
  PlayerSelect: ({
    players,
    onSelect,
    label,
  }: {
    players: { id: number; name: string; avatarUrl?: string | null }[];
    onSelect: (p: { id: number; name: string; avatarUrl?: string | null }) => void;
    label: string;
  }) => (
    <button type="button" data-testid={`pick:${label}`} onClick={() => players[0] && onSelect(players[0])}>
      {label}
    </button>
  ),
}));

import { acquireLease, createGoal } from "../api/stewardApi";
import { fetchMeetupDetail } from "../api/meetupsApi";

const acquireLeaseMock = vi.mocked(acquireLease);
const createGoalMock = vi.mocked(createGoal);
const fetchDetailMock = vi.mocked(fetchMeetupDetail);

const match: MatchSummary = {
  id: 10,
  meetup_id: 1,
  match_number: 1,
  team_a: {
    name: "Blue",
    users: [
      { id: 1, display_name: "P1", avatar_url: null },
      { id: 2, display_name: "P2", avatar_url: null },
    ],
  },
  team_b: {
    name: "Gold",
    users: [{ id: 3, display_name: "P3", avatar_url: null }],
  },
  score_a: 0,
  score_b: 0,
  status: "active",
  timer_total_seconds: 600,
  timer_seconds_remaining: 600,
  timer_paused: false,
  timer_ends_at: null,
  created_at: null,
  completed_at: null,
};

const detail = {
  attendees: [
    { user_id: 1, status: "confirmed", display_name: "P1", avatar_url: null },
    { user_id: 2, status: "confirmed", display_name: "P2", avatar_url: null },
    { user_id: 3, status: "confirmed", display_name: "P3", avatar_url: null },
  ],
};

const renderSheet = (onLogged = vi.fn(), onClose = vi.fn()) => {
  const utils = render(
    <GoalEntrySheet meetupId={1} match={match} onClose={onClose} onLogged={onLogged} />,
  );
  return { ...utils, onLogged, onClose };
};

const pickScorer = async () => {
  const scorerBtn = await screen.findByTestId("pick:2 · Scorer");
  fireEvent.click(scorerBtn);
};

describe("GoalEntrySheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireLeaseMock.mockResolvedValue({ ok: true, lease: { lease_token: "tok", holder_name: "P1", expires_in: 45 } } as never);
    fetchDetailMock.mockResolvedValue(detail as never);
    createGoalMock.mockResolvedValue({ goal: { id: 5 }, miss: null } as never);
  });

  it("hides the assist picker and offers a Miss row when Penalty is on", async () => {
    renderSheet();
    await screen.findByTestId("pick:2 · Scorer");

    fireEvent.click(screen.getByRole("switch", { name: "Penalty" }));

    // Own goal switch is disabled; assist picker is gone; Miss row appears.
    expect(screen.getByRole("switch", { name: "Own goal" })).toBeDisabled();
    expect(screen.queryByTestId(/pick:3 · Assist/)).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Miss" })).toBeInTheDocument();
  });

  it("submits a penalty goal with assist forced to null", async () => {
    const onLogged = vi.fn();
    renderSheet(onLogged);
    await pickScorer();
    fireEvent.click(screen.getByRole("switch", { name: "Penalty" }));

    fireEvent.click(screen.getByRole("button", { name: /Confirm goal/ }));

    await waitFor(() =>
      expect(createGoalMock).toHaveBeenCalledWith(
        1,
        10,
        expect.objectContaining({
          scorer_id: 1,
          assist_id: null,
          is_penalty: true,
          missed: false,
        }),
      ),
    );
    expect(onLogged).toHaveBeenCalledTimes(1);
  });

  it("submits a missed penalty — no goal, miss row logged", async () => {
    const onLogged = vi.fn();
    const onClose = vi.fn();
    createGoalMock.mockResolvedValue({ miss: { id: 9 }, goal: null } as never);
    renderSheet(onLogged, onClose);
    await pickScorer();
    fireEvent.click(screen.getByRole("switch", { name: "Penalty" }));
    fireEvent.click(screen.getByRole("switch", { name: "Miss" }));

    // Assist picker is hidden and the keeper picker is gone too.
    expect(screen.queryByTestId(/pick:3 · Assist/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/Goalkeeper/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Log penalty miss/ }));

    await waitFor(() =>
      expect(createGoalMock).toHaveBeenCalledWith(
        1,
        10,
        expect.objectContaining({
          scorer_id: 1,
          assist_id: null,
          goalkeeper_id: null,
          is_penalty: true,
          missed: true,
        }),
      ),
    );
    expect(onLogged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the penalty and miss when the Penalty switch is turned off", async () => {
    renderSheet();
    await screen.findByTestId("pick:2 · Scorer");
    fireEvent.click(screen.getByRole("switch", { name: "Penalty" }));
    fireEvent.click(screen.getByRole("switch", { name: "Miss" }));
    fireEvent.click(screen.getByRole("switch", { name: "Penalty" }));

    // Miss row is gone; assist picker is back.
    expect(screen.queryByRole("switch", { name: "Miss" })).not.toBeInTheDocument();
    expect(screen.getByTestId("pick:3 · Assist (optional — one assist max)")).toBeInTheDocument();
  });
});
