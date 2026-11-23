import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchMeetupMatches, type MatchSummary } from "../api/matchesApi";
import { fetchMeetupDetail, fetchMeetupTeams } from "../api/meetupsApi";
import { fetchGoals, fetchStewardState } from "../api/stewardApi";
import { RefereePage } from "./RefereePage";

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
}));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ tokens: { accessToken: "token" } }) }));
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
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

async function openReferee() {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={["/meetup-matches/1"]}>
        <Routes><Route path="/meetup-matches/:meetupId" element={<RefereePage />} /></Routes>
      </MemoryRouter>,
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
