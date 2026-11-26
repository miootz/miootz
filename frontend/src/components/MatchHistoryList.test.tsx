import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  deleteMatch, fetchMatchSubstitutions, fetchMeetupMatches,
  recordHistoricalSubstitution, type MatchSummary,
} from "../api/matchesApi";
import { fetchHistoricalGoals, saveHistoricalGoal } from "../api/stewardApi";
import { AuthContext } from "../auth/auth-context";
import { MatchHistoryList } from "./MatchHistoryList";

vi.mock("../api/matchesApi");
vi.mock("../api/stewardApi");
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const player = (id: number, display_name: string) => ({ id, display_name, avatar_url: null });
const alice = player(1, "Alice");
const bob = player(2, "Bob");
const cara = player(3, "Cara");
const match: MatchSummary = {
  id: 7, meetup_id: 1, match_number: 1,
  team_a: { name: "Violet", users: [alice] },
  team_b: { name: "Mint", users: [bob] },
  score_a: 0, score_b: 0, status: "completed",
  timer_total_seconds: 600, timer_seconds_remaining: 0, timer_paused: false,
  created_at: null, completed_at: null,
};

function renderHistory() {
  const noop = async () => {};
  render(
    <AuthContext.Provider value={{
      me: { is_admin: true, auth_groups: [], user: { id: 1, is_admin: true, pocket_id_sub: "test" } },
      loading: false, error: null, tokens: null, login: noop, logout: noop,
      refresh: noop, savePosition: noop,
    }}>
      <MatchHistoryList meetupId={1} editable attendees={[alice, bob, cara].map((p) => ({
        ...p, user_id: p.id, status: "confirmed", joined_at: null, skill: 3,
      }))} />
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.mocked(fetchMeetupMatches).mockResolvedValue({ matches: [match], match_duration_minutes: 10 });
  vi.mocked(fetchMatchSubstitutions).mockResolvedValue({ substitutions: [] });
  vi.mocked(fetchHistoricalGoals).mockResolvedValue({ goals: [], rosters: { a: [alice], b: [bob] } });
});

it("uses the saved lineup for goal entry and updates the open match after two saves", async () => {
  const updatedMatch = { ...match, team_a: { ...match.team_a, users: [alice, cara] } };
  vi.mocked(recordHistoricalSubstitution).mockResolvedValue({
    match: updatedMatch, substitutions: [],
  });
  vi.mocked(fetchHistoricalGoals).mockResolvedValueOnce({ goals: [], rosters: { a: [alice], b: [bob] } })
    .mockResolvedValue({ goals: [], rosters: { a: [alice, cara], b: [bob] } });
  for (const id of [1, 2]) {
    vi.mocked(saveHistoricalGoal).mockResolvedValueOnce({
      goal: { id, team: "a", clock_minute: 0, scorer: cara, assist: null, goalkeeper: null, recorded_by: alice },
      score_a: id, score_b: 0, was_draw: false,
    });
  }
  renderHistory();
  fireEvent.click(await screen.findByRole("button", { name: "Edit match 1" }));
  const editor = within(screen.getByRole("dialog", { name: "Edit match #1" }));
  fireEvent.click(editor.getByRole("button", { name: "Edit lineup" }));
  fireEvent.click(await within(await editor.findByRole("list", { name: "Bench" }))
    .findByRole("button", { name: "Cara" }));
  fireEvent.click(editor.getByRole("button", { name: "Add to Violet" }));
  await waitFor(() => expect(fetchHistoricalGoals).toHaveBeenCalledTimes(2));

  for (const score of [1, 2]) {
    fireEvent.click(await editor.findByRole("button", { name: "Add goal" }));
    const goalSheet = within(screen.getByRole("dialog", { name: "Add goal" }));
    fireEvent.click(goalSheet.getByRole("button", { name: "Cara" }));
    fireEvent.click(goalSheet.getByRole("button", { name: "Skip assist" }));
    fireEvent.click(goalSheet.getByRole("button", { name: "Skip goalkeeper" }));
    fireEvent.click(goalSheet.getByRole("button", { name: "Confirm goal" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add goal" })).not.toBeInTheDocument());
    expect(editor.getByText(String(score), { selector: ".text-3xl" })).toBeVisible();
  }
  expect(saveHistoricalGoal).toHaveBeenCalledTimes(2);
  expect(saveHistoricalGoal).toHaveBeenLastCalledWith(1, 7, expect.objectContaining({
    team: "a", scorer_id: cara.id, add_to_score: true,
  }));
});

it("locks the goal log after a shootout and keeps failed match deletion visible in the dialog", async () => {
  vi.mocked(fetchMeetupMatches).mockResolvedValue({
    matches: [{ ...match, penalty_winner: "a" }], match_duration_minutes: 10,
  });
  vi.mocked(deleteMatch).mockRejectedValue(new Error("The match could not be deleted."));
  renderHistory();
  fireEvent.click(await screen.findByRole("button", { name: "Edit match 1" }));
  const editor = within(screen.getByRole("dialog", { name: "Edit match #1" }));
  expect(editor.getByText(/Goals are locked after a shootout/)).toBeVisible();
  expect(editor.queryByRole("button", { name: "Add goal" })).not.toBeInTheDocument();
  fireEvent.click(editor.getByRole("button", { name: "Delete" }));
  fireEvent.click(editor.getByRole("button", { name: "Confirm delete" }));
  expect(await editor.findByText("The match could not be deleted.")).toBeVisible();
});
