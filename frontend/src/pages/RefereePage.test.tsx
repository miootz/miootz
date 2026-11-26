import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fetchMeetupMatches,
  endMatch,
  deleteMatch,
  createNewPendingMatch,
  fetchPenalty,
  skipPenaltyShootout,
  startMatches,
  type MatchSummary,
} from "../api/matchesApi";
import { fetchMeetupDetail, fetchMeetupTeams } from "../api/meetupsApi";
import {
  fetchGoals,
  fetchStewardState,
  acquireLease,
  renewLease,
  releaseLease,
} from "../api/stewardApi";
import { RefereePage } from "./RefereePage";
import { AuthContext } from "../auth/auth-context";

const { feed, showToast } = vi.hoisted(() => ({
  feed: {
    message: (_data: Record<string, unknown>) => {},
    live: (_live: boolean) => {},
  },
  showToast: vi.fn(),
}));

vi.mock("../api/matchesApi", async (original) => ({
  ...await original<typeof import("../api/matchesApi")>(),
  fetchMeetupMatches: vi.fn(),
  endMatch: vi.fn(),
  deleteMatch: vi.fn(),
  createNewPendingMatch: vi.fn(),
  fetchPenalty: vi.fn(),
  skipPenaltyShootout: vi.fn(),
  startMatches: vi.fn(),
}));
vi.mock("../api/meetupsApi", async (original) => ({
  ...await original<typeof import("../api/meetupsApi")>(),
  fetchMeetupDetail: vi.fn(),
  fetchMeetupTeams: vi.fn(),
}));
vi.mock("../api/stewardApi", async (original) => ({
  ...await original<typeof import("../api/stewardApi")>(),
  fetchGoals: vi.fn(),
  fetchStewardState: vi.fn(),
  acquireLease: vi.fn(),
  renewLease: vi.fn(),
  releaseLease: vi.fn(),
}));
vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ tokens: { accessToken: "token" } }),
}));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../utils/meetupDataBus", () => ({
  subscribeMeetupData: (
    _sid: number,
    _token: string,
    message: typeof feed.message,
    live: typeof feed.live,
  ) => {
    feed.message = message;
    feed.live = live;
    live(false);
    return () => {};
  },
}));
vi.mock("../components/GoalEntrySheet", () => ({
  GoalEntrySheet: ({ onLogged }: { onLogged: () => void }) => (
    <button type="button" onClick={onLogged}>Save goal</button>
  ),
}));

HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };

const match: MatchSummary = {
  id: 10,
  meetup_id: 1,
  match_number: 1,
  team_a: { name: "Blue", users: [] },
  team_b: { name: "Gold", users: [] },
  score_a: 0,
  score_b: 0,
  status: "active",
  timer_total_seconds: 900,
  timer_seconds_remaining: 600,
  timer_paused: true,
  created_at: null,
  completed_at: null,
};
const response = (score = 0) => ({
  matches: [{ ...match, score_a: score }],
  match_duration_minutes: 15,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchMeetupMatches).mockResolvedValue(response());
  vi.mocked(fetchMeetupTeams).mockResolvedValue({ meetup_id: 1, content_revision: 0, teams: [] });
  vi.mocked(fetchMeetupDetail).mockResolvedValue({
    id: 1, start_time: "", location: "Pitch", fee: 0, min_players: 2,
    max_players: 10, latitude: null, longitude: null, waitlist_mode: "manual",
    content_revision: 0, attendees: [], my_attendance: "confirmed",
  });
  vi.mocked(fetchStewardState).mockResolvedValue({ can_control: true, reason: "ok", lease: null });
  vi.mocked(fetchGoals).mockResolvedValue([]);
  vi.mocked(acquireLease).mockResolvedValue({
    ok: true,
    lease: { lease_token: "t", expires_in: 45 },
  });
  vi.mocked(renewLease).mockResolvedValue({
    ok: true,
    lease: { lease_token: "t", expires_in: 45 },
  });
  vi.mocked(releaseLease).mockResolvedValue(undefined);
  vi.mocked(endMatch).mockResolvedValue({
    status: "completed",
    match: { ...match, status: "completed" },
    winner_team: "a",
    winner_name: "Blue",
    all_matches_complete: true,
  });
  vi.mocked(deleteMatch).mockResolvedValue(undefined);
  vi.mocked(createNewPendingMatch).mockResolvedValue({
    status: "pending",
    match: { ...match, status: "pending" },
  });
  vi.mocked(startMatches).mockResolvedValue({
    status: "already_started",
    match: { ...match, status: "pending" },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

async function openReferee(admin = false) {
  await act(async () => {
    render(
      <AuthContext.Provider
        value={{
          me: { user: { display_name: "Alex" }, is_admin: admin, auth_groups: [] },
          loading: false,
          error: null,
          tokens: { accessToken: "token" },
          refresh: async () => {},
          savePosition: async () => {},
          login: async () => {},
          logout: async () => {},
        } as unknown as React.ContextType<typeof AuthContext>}
      >
        <MemoryRouter initialEntries={["/meetup-matches/1"]}>
          <Routes><Route path="/meetup-matches/:meetupId" element={<RefereePage />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  });
  expect(screen.getByText("Match Control")).toBeInTheDocument();
  vi.mocked(fetchMeetupMatches).mockClear();
  vi.mocked(fetchMeetupTeams).mockClear();
  vi.mocked(fetchGoals).mockClear();
}

it("batches goal, lease, meetup and local-save events into one refresh", async () => {
  await openReferee();
  fireEvent.click(screen.getByRole("button", { name: "+ Goal" }));
  await act(async () => {
    feed.message({ type: "lease_acquired", holder_name: "Alex", expires_in: 45 });
    feed.message({ type: "goal_added", match_id: 10 });
    feed.message({ type: "lease_released", match_id: 10 });
    feed.message({ type: "meetup_updated" });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(fetchMeetupMatches).toHaveBeenCalledTimes(1);
  expect(fetchMeetupTeams).toHaveBeenCalledTimes(1);

  await act(async () => {
    feed.message({ type: "lease_acquired", holder_name: "Alex", expires_in: 45 });
    feed.message({ type: "lease_released" });
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(fetchMeetupMatches).toHaveBeenCalledTimes(1);
  expect(fetchMeetupTeams).toHaveBeenCalledTimes(1);
});

it("bounds refresh delay during a continuous stream of changes", async () => {
  await openReferee();
  await act(async () => {
    feed.message({ type: "goal_added" });
    await vi.advanceTimersByTimeAsync(75);
    feed.message({ type: "meetup_updated" });
    await vi.advanceTimersByTimeAsync(25);
  });
  expect(fetchMeetupMatches).toHaveBeenCalledTimes(1);
  expect(fetchMeetupTeams).toHaveBeenCalledTimes(1);
});

it("refreshes snapshots immediately after reconnect and cancels a queued refresh", async () => {
  await openReferee();
  vi.mocked(fetchMeetupMatches).mockResolvedValue(response(2));
  await act(async () => {
    feed.message({ type: "goal_added" });
    feed.live(false);
    feed.live(true);
  });
  expect(fetchMeetupMatches).toHaveBeenCalledTimes(1);
  expect(fetchMeetupTeams).toHaveBeenCalledTimes(1);
  expect(fetchGoals).toHaveBeenCalled();
  expect(screen.getByText("—", { selector: "p > span" }).parentElement).toHaveTextContent("2—0");
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(fetchMeetupMatches).toHaveBeenCalledTimes(1);
});

it("takes a fresh snapshot when an event arrives during a request", async () => {
  await openReferee();
  let finishFirst!: (value: ReturnType<typeof response>) => void;
  vi.mocked(fetchMeetupMatches)
    .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
    .mockResolvedValueOnce(response(3));
  await act(async () => {
    feed.live(true);
    feed.message({ type: "goal_updated" });
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(fetchMeetupMatches).toHaveBeenCalledTimes(1);
  await act(async () => { finishFirst(response()); });
  expect(fetchMeetupMatches).toHaveBeenCalledTimes(2);
  expect(fetchMeetupTeams).toHaveBeenCalledTimes(2);
  expect(screen.getByText("—", { selector: "p > span" }).parentElement).toHaveTextContent("3—0");
});

it("updates an edited match's score and goal log from the same snapshot", async () => {
  const completed: MatchSummary = {
    ...match, id: 11, match_number: 2, status: "completed", score_a: 1,
    team_a: { name: "Red", users: [] }, team_b: { name: "Green", users: [] },
  };
  vi.mocked(fetchMeetupMatches).mockResolvedValue({ ...response(), matches: [match, completed] });
  await openReferee();
  fireEvent.click(screen.getByRole("button", { name: "Edit match 2" }));
  const form = screen.getByRole("heading", { name: "Edit match result" }).parentElement!;
  fireEvent.click(within(form).getByRole("button", { name: "Goal" }));
  vi.mocked(fetchMeetupMatches).mockResolvedValue({
    ...response(), matches: [match, { ...completed, score_a: 2 }],
  });
  vi.mocked(fetchGoals).mockClear();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(fetchMeetupMatches).toHaveBeenCalledTimes(1);
  expect(within(form).getByText("2", { selector: "span" })).toBeInTheDocument();
  expect(fetchGoals).toHaveBeenCalledWith(1, 11);
});

it("updates match scores even when a team request is slow", async () => {
  await openReferee();
  let finishTeams!: (value: Awaited<ReturnType<typeof fetchMeetupTeams>>) => void;
  vi.mocked(fetchMeetupTeams).mockImplementationOnce(() => new Promise((resolve) => { finishTeams = resolve; }));
  vi.mocked(fetchMeetupMatches).mockResolvedValueOnce(response(1)).mockResolvedValueOnce(response(2));
  await act(async () => {
    feed.live(true);
    feed.message({ type: "goal_added" });
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(fetchMeetupMatches).toHaveBeenCalledTimes(2);
  expect(screen.getByText("—", { selector: "p > span" }).parentElement).toHaveTextContent("2—0");
  await act(async () => finishTeams({ meetup_id: 1, content_revision: 0, teams: [] }));
});

it("shows the live bottom deck with the primary controls for a paused match", async () => {
  await openReferee();
  // Active + paused fixture: Resume, + Goal, End Match.
  // Reset and Delete live in the admin setup sheet (team reshape).
  expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "+ Goal" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "End Match" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
});

it("shows Start Timer in the deck for a pending match", async () => {
  const pending: MatchSummary = {
    ...match, status: "pending", timer_paused: false, timer_seconds_remaining: 900,
  };
  vi.mocked(fetchMeetupMatches).mockResolvedValue({ ...response(), matches: [pending] });
  await openReferee();
  expect(screen.getByRole("button", { name: "Start Timer" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "+ Goal" })).toBeInTheDocument();
});


it("ends a match via the button and offers Start new match instead of auto-starting", async () => {
  await openReferee();
  // After the end the server has no pending match — all matches completed.
  vi.mocked(fetchMeetupMatches).mockResolvedValue({
    ...response(),
    matches: [{ ...match, status: "completed", score_a: 3, score_b: 1 }],
  });

  fireEvent.click(screen.getByRole("button", { name: "End Match" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "End match" }));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });

  // The skip flag: the next match is NOT auto-queued.
  expect(vi.mocked(endMatch)).toHaveBeenCalledWith(1, 10, undefined, true);
  // The referee sees the Start new match flow, not the live deck.
  expect(screen.getByRole("button", { name: "Start new match" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "End Match" })).not.toBeInTheDocument();
});


it("offers Start new match after the last match is deleted", async () => {
  const completed: MatchSummary = {
    ...match,
    status: "completed",
    score_a: 2,
    score_b: 1,
    team_a: { name: "Red", users: [] },
    team_b: { name: "Green", users: [] },
  };
  vi.mocked(fetchMeetupMatches).mockResolvedValue({ ...response(), matches: [completed] });
  await openReferee(true);

  // Edit the completed match → delete button → confirm.
  fireEvent.click(screen.getByRole("button", { name: "Edit match 1" }));
  const form = screen.getByRole("heading", { name: "Edit match result" }).parentElement!;
  fireEvent.click(within(form).getByRole("button", { name: "Delete match" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

  // The match list is now empty — the Start new match flow shows.
  vi.mocked(fetchMeetupMatches).mockResolvedValue({ ...response(), matches: [] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });

  expect(vi.mocked(deleteMatch)).toHaveBeenCalledWith(1, 10);
  expect(screen.getByRole("button", { name: "Start new match" })).toBeInTheDocument();
  expect(screen.getByText("0 matches recorded")).toBeInTheDocument();
});


it("starts a new match from the Start new match flow with picked teams", async () => {
  vi.mocked(fetchMeetupTeams).mockResolvedValue({
    meetup_id: 1,
    content_revision: 0,
    teams: [
      { id: "a", name: "Blue", players: [] },
      { id: "b", name: "Gold", players: [] },
    ],
  });
  // All-complete from the start: the only match is completed.
  vi.mocked(fetchMeetupMatches).mockResolvedValue({
    ...response(),
    matches: [{ ...match, status: "completed", score_a: 1 }],
  });
  await openReferee();
  fireEvent.click(screen.getByRole("button", { name: "Start new match" }));
  // Default selection is team A = 0, team B = 1 — Start match is enabled.
  fireEvent.click(screen.getByRole("button", { name: "Start match" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(vi.mocked(createNewPendingMatch)).toHaveBeenCalledWith(1, {
    team_a_idx: 0,
    team_b_idx: 1,
  });
});

it("blocks the next match until the referee skips the shootout", async () => {
  const opener: MatchSummary = { ...match, status: "completed" };
  const shootout = { available: true, winner: null, shots: [], counts: { a: 0, b: 0 }, decided: false };
  vi.mocked(fetchMeetupMatches).mockResolvedValue({ ...response(), matches: [opener] });
  vi.mocked(fetchPenalty).mockResolvedValue(shootout);
  vi.mocked(skipPenaltyShootout).mockImplementation(async () => {
    vi.mocked(fetchMeetupMatches).mockResolvedValue({
      ...response(), matches: [{ ...opener, penalty_skipped: true }],
    });
    return { ...shootout, available: false };
  });
  await openReferee();
  expect(screen.getByRole("button", { name: "Start new match" })).toBeDisabled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Skip shootout" }));
  });
  expect(skipPenaltyShootout).toHaveBeenCalledWith(1, 10);
  expect(screen.getByRole("button", { name: "Start new match" })).toBeEnabled();
});


it("starts the schedule from scratch when adding the first match after a delete", async () => {
  const completed: MatchSummary = {
    ...match,
    status: "completed",
    score_a: 2,
    score_b: 1,
    team_a: { name: "Red", users: [] },
    team_b: { name: "Green", users: [] },
  };
  vi.mocked(fetchMeetupMatches).mockResolvedValue({ ...response(), matches: [completed] });
  await openReferee(true);

  fireEvent.click(screen.getByRole("button", { name: "Edit match 1" }));
  const form = screen.getByRole("heading", { name: "Edit match result" }).parentElement!;
  fireEvent.click(within(form).getByRole("button", { name: "Delete match" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

  vi.mocked(fetchMeetupMatches).mockResolvedValue({ ...response(), matches: [] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });

  // The referee opens Start new match → Start match.
  fireEvent.click(screen.getByRole("button", { name: "Start new match" }));
  fireEvent.click(screen.getByRole("button", { name: "Start match" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });

  // No completed match to build from — the default start flow is used.
  expect(vi.mocked(startMatches)).toHaveBeenCalledWith(1, {
    team_a_idx: 0,
    team_b_idx: 1,
  });
  expect(vi.mocked(createNewPendingMatch)).not.toHaveBeenCalled();
});


it("opens the substitutions sheet and closes it", async () => {
  await openReferee(true);

  fireEvent.click(screen.getByRole("button", { name: "Substitutions" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });

  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Substitutions" })).toBeInTheDocument();
  // The rosters render inside the sheet.
  expect(within(dialog).getByText("Blue")).toBeInTheDocument();

  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
