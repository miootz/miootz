import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { fetchMeetupDetail, fetchMeetups, fetchMeetupTeams } from "../api/meetupsApi";
import { PlayerApp } from "./PlayerApp";

const listeners = vi.hoisted(() => ({
  message: null as ((data: Record<string, unknown>) => void) | null,
  live: null as ((connected: boolean) => void) | null,
}));
const setHeader = vi.hoisted(() => vi.fn());

vi.mock("../api/meetupsApi", () => ({
  fetchMeetups: vi.fn(),
  fetchMeetupDetail: vi.fn(),
  fetchMeetupTeams: vi.fn(),
}));
vi.mock("../api/meApi", () => ({ mediaUrl: () => undefined }));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({
  me: null,
  tokens: { accessToken: "test-token" },
}) }));
vi.mock("../context/MemberShellContext", () => ({ useMemberShell: () => ({ setHeader }) }));
vi.mock("../stores/meetupChatCache", () => ({ clearMeetupChatCache: async () => {} }));
vi.mock("../offline/engagement", () => ({ recordMeetupView: () => {} }));
vi.mock("../offline/meetupSnapshot", () => ({
  loadMeetupSnapshot: async () => null,
  saveMeetupSnapshot: async () => {},
}));
vi.mock("../utils/meetupDataBus", () => ({
  subscribeMeetupData: () => () => {},
  subscribeMeetupList: (
    _token: string,
    message: typeof listeners.message,
    live: typeof listeners.live,
  ) => {
    listeners.message = message;
    listeners.live = live;
    return () => { listeners.message = null; listeners.live = null; };
  },
}));
vi.mock("./MeetupDetails", () => ({
  MeetupDetails: ({ meetup }: { meetup: { location: string } }) =>
    <button>Join meetup at {meetup.location}</button>,
}));
vi.mock("../components/OnboardingCard", () => ({ OnboardingCard: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  listeners.message = null;
  listeners.live = null;
  vi.mocked(fetchMeetups).mockResolvedValue({ items: [], total: 1, limit: null, offset: 0 });
  vi.mocked(fetchMeetupDetail).mockResolvedValue({
    id: 10,
    start_time: "2099-01-01T18:00:00",
    location: "Pitch",
    attendees: [],
    my_attendance: null,
  } as never);
  vi.mocked(fetchMeetupTeams).mockResolvedValue({ meetup_id: 10, content_revision: 0, teams: [] });
});

it("shows a new signup on the open overview and refreshes after reconnecting", async () => {
  render(<PlayerApp />);
  expect(await screen.findByText("No upcoming meetup. Past meetups are in History.")).toBeInTheDocument();

  vi.mocked(fetchMeetups).mockResolvedValue({
    items: [{ id: 10, start_time: "2099-01-01T18:00:00" } as never],
    total: 1,
    limit: null,
    offset: 0,
  });
  await act(async () => listeners.message?.({ type: "meetup_list_changed" }));
  expect(await screen.findByRole("button", { name: "Join meetup at Pitch" })).toBeInTheDocument();

  vi.mocked(fetchMeetups).mockClear();
  await act(async () => listeners.live?.(true));
  await waitFor(() => expect(fetchMeetups).toHaveBeenCalled());
});

it("keeps a new meetup when an older list request finishes late", async () => {
  let finishOldRequest!: (value: Awaited<ReturnType<typeof fetchMeetups>>) => void;
  vi.mocked(fetchMeetups)
    .mockImplementationOnce(() => new Promise((resolve) => { finishOldRequest = resolve; }))
    .mockResolvedValueOnce({
      items: [{ id: 10, start_time: "2099-01-01T18:00:00" } as never],
      total: 1,
      limit: null,
      offset: 0,
    });

  render(<PlayerApp />);
  await act(async () => listeners.message?.({ type: "meetup_list_changed" }));
  await act(async () => finishOldRequest({ items: [], total: 1, limit: null, offset: 0 }));
  expect(await screen.findByRole("button", { name: "Join meetup at Pitch" })).toBeInTheDocument();
});

it("switches from the current meetup when the next signup appears", async () => {
  let nextAvailable = false;
  const previous = {
    id: 9,
    start_time: new Date(Date.now() - 30 * 60_000).toISOString(),
    duration_minutes: 120,
  };
  const next = { id: 10, start_time: "2099-01-01T18:00:00" };
  vi.mocked(fetchMeetups).mockImplementation(async ({ status } = {}) => {
    const items = nextAvailable ? [next] : status === "upcoming" ? [] : [previous];
    return { items: items as never[], total: items.length, limit: null, offset: 0 };
  });
  vi.mocked(fetchMeetupDetail).mockImplementation(async (id) => ({
    id,
    start_time: id === 9 ? previous.start_time : next.start_time,
    location: id === 9 ? "Previous pitch" : "Next pitch",
    attendees: [],
    my_attendance: null,
  } as never));

  render(<PlayerApp />);
  expect(await screen.findByRole("button", { name: "Join meetup at Previous pitch" })).toBeInTheDocument();
  nextAvailable = true;
  await act(async () => listeners.message?.({ type: "meetup_list_changed" }));
  expect(await screen.findByRole("button", { name: "Join meetup at Next pitch" })).toBeInTheDocument();
});
