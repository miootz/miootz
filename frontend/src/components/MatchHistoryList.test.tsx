import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  deleteMatch, fetchMatchSubstitutions, fetchMeetupMatches,
  recordHistoricalSubstitution, type MatchSummary,
} from "../api/matchesApi";
import { deletePenaltyMiss, fetchHistoricalGoals, fetchPenaltyMisses, fetchGoals, saveHistoricalGoal } from "../api/stewardApi";
import { AuthContext } from "../auth/auth-context";
import { MatchHistoryList } from "./MatchHistoryList";

const feed = vi.hoisted(() => ({ message: (_: Record<string, unknown>) => {} }));
vi.mock("../utils/meetupDataBus", () => ({
  subscribeMeetupData: (_id: number, _token: string, message: typeof feed.message) => {
    feed.message = message;
    return () => {};
  },
}));
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

function historyTree(meetupId = 1, token = false) {
  const noop = async () => {};
  return (
    <MemoryRouter><AuthContext.Provider value={{
      me: { is_admin: true, auth_groups: [], user: { id: 1, is_admin: true, pocket_id_sub: "test" } },
      loading: false, error: null, tokens: token ? { accessToken: "test" } as never : null, login: noop, logout: noop,
      refresh: noop, savePosition: noop,
    }}>
      <MatchHistoryList meetupId={meetupId} editable attendees={[alice, bob, cara].map((p) => ({
        ...p, user_id: p.id, status: "confirmed", joined_at: null, skill: 3,
      }))} />
    </AuthContext.Provider></MemoryRouter>
  );
}
function renderHistory(meetupId = 1, token = false) {
  return render(historyTree(meetupId, token));
}

beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.mocked(fetchMeetupMatches).mockResolvedValue({ matches: [match], match_duration_minutes: 10 });
  vi.mocked(fetchMatchSubstitutions).mockResolvedValue({ substitutions: [] });
  vi.mocked(fetchGoals).mockResolvedValue([]);
  vi.mocked(fetchPenaltyMisses).mockResolvedValue([]);
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


it("refreshes expanded penalty misses once per live event", async () => {
  renderHistory(1, true);
  fireEvent.click(await screen.findByRole("button", { name: /Match 1/ }));
  await waitFor(() => expect(fetchPenaltyMisses).toHaveBeenCalledTimes(1));
  vi.mocked(fetchPenaltyMisses).mockResolvedValue([{ id: 8, team: "a", clock_minute: 6, scorer: alice }]);
  await act(async () => feed.message({ type: "penalty_missed", match_id: match.id }));
  expect(await screen.findByText(/Alice \(miss\)/)).toBeVisible();
  expect(fetchPenaltyMisses).toHaveBeenCalledTimes(2);
  vi.mocked(fetchPenaltyMisses).mockResolvedValue([]);
  await act(async () => feed.message({ type: "penalty_miss_removed", match_id: match.id }));
  await waitFor(() => expect(screen.queryByText(/Alice \(miss\)/)).not.toBeInTheDocument());
  expect(fetchPenaltyMisses).toHaveBeenCalledTimes(3);
});

it("does not show the previous meetup while a different meetup loads", async () => {
  const { rerender } = renderHistory();
  expect(await screen.findByRole("button", { name: /Match 1/ })).toBeVisible();
  let resolveNext!: (value: Awaited<ReturnType<typeof fetchMeetupMatches>>) => void;
  vi.mocked(fetchMeetupMatches).mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));
  rerender(historyTree(2));
  expect(screen.queryByRole("button", { name: /Match 1/ })).not.toBeInTheDocument();
  expect(screen.getByText("Loading matches…")).toBeVisible();
  await act(async () => resolveNext({ matches: [], match_duration_minutes: 10 }));
  expect(screen.getByText("No match results recorded yet.")).toBeVisible();
});


it("lets an admin remove a penalty miss from match history", async () => {
  vi.mocked(fetchPenaltyMisses).mockResolvedValue([{ id: 8, team: "a", clock_minute: 6, scorer: alice }]);
  vi.mocked(deletePenaltyMiss).mockResolvedValue();
  renderHistory();
  fireEvent.click(await screen.findByRole("button", { name: /Match 1/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete penalty miss by Alice" }));
  await waitFor(() => expect(deletePenaltyMiss).toHaveBeenCalledWith(1, match.id, 8));
  await waitFor(() => expect(screen.queryByText(/Alice \(miss\)/)).not.toBeInTheDocument());
});
