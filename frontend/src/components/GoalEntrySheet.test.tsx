import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { acquireLease, createGoal } from "../api/stewardApi";
import type { MatchSummary } from "../api/matchesApi";
import { GoalEntrySheet } from "./GoalEntrySheet";

vi.mock("../api/stewardApi", () => ({
  acquireLease: vi.fn(),
  createGoal: vi.fn(),
  renewLease: vi.fn(),
  releaseLease: vi.fn(),
  updateGoal: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: toast }) }));

const player = (id: number, display_name: string) => ({ id, display_name, avatar_url: null });
const match: MatchSummary = {
  id: 7, meetup_id: 1, match_number: 1,
  team_a: { name: "Violet FC", users: [player(1, "Andrea Pirlo"), player(2, "Pelé")] },
  team_b: { name: "Mint United", users: [player(3, "Johan Cruyff"), player(4, "Gianluigi Buffon")] },
  score_a: 0, score_b: 0, status: "active",
  timer_total_seconds: 600, timer_seconds_remaining: 360, timer_paused: true,
  created_at: null, completed_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.mocked(acquireLease).mockResolvedValue({ ok: true, lease: { lease_token: "test", expires_in: 45 } });
  vi.mocked(createGoal).mockResolvedValue({ goal: null });
});

it("shows both rosters first and saves the confirmed minute with the scorer's team", async () => {
  render(<GoalEntrySheet meetupId={1} match={match} onClose={vi.fn()} onLogged={vi.fn()} />);
  expect(screen.getByRole("list", { name: "Violet FC" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("list", { name: "Mint United" })).getByRole("button", { name: "Johan Cruyff" }));
  expect(screen.getByRole("heading", { name: "Choose assist" })).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Johan Cruyff" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Skip assist" }));
  fireEvent.click(within(screen.getByRole("list", { name: "Violet FC" })).getByRole("button", { name: "Andrea Pirlo" }));
  expect(screen.getByText("Goal for Mint United")).toBeInTheDocument();
  expect(screen.getByText("4′")).toBeInTheDocument();
  const increase = screen.getByRole("button", { name: "Increase minute" });
  fireEvent.click(increase);
  fireEvent.click(increase);
  fireEvent.click(increase);
  expect(screen.getByText("7′")).toBeInTheDocument();
  const confirm = screen.getByRole("button", { name: "Confirm goal" });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(createGoal).toHaveBeenCalledWith(1, 7, expect.objectContaining({
    team: "b", scorer_id: 3, assist_id: null, goalkeeper_id: 1, clock_minute: 7,
  })));
});

it("credits the other team for an own goal and skips the assist step", async () => {
  render(<GoalEntrySheet meetupId={1} match={match} onClose={vi.fn()} onLogged={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Own goal" }));
  fireEvent.click(screen.getByRole("button", { name: "Johan Cruyff" }));
  expect(screen.getByRole("heading", { name: "Choose goalkeeper" })).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Johan Cruyff" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Gianluigi Buffon" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Skip goalkeeper" }));
  expect(screen.getByText("Goal for Violet FC")).toBeInTheDocument();
  const confirm = screen.getByRole("button", { name: "Confirm goal" });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(createGoal).toHaveBeenCalledWith(1, 7, expect.objectContaining({
    team: "a", scorer_id: 3, assist_id: null, goalkeeper_id: null, is_own_goal: true,
  })));
});
