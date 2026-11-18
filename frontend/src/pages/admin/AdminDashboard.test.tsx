import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMeetupDetail, fetchMeetups } from "../../api/meetupsApi";
import { AdminDashboard } from "./AdminDashboard";

vi.mock("../../api/meetupsApi", () => ({
  fetchMeetups: vi.fn(),
  fetchMeetupDetail: vi.fn(),
  skipMeetup: vi.fn(),
}));
vi.mock("../../api/adminApi", () => ({
  adminListGameTemplates: async () => ({ items: [] }),
}));
vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ tokens: null }) }));
vi.mock("../../utils/meetupDataBus", () => ({
  subscribeMeetupData: () => () => {},
}));
vi.mock("../../components/MeetupChat", () => ({ MeetupChat: () => null }));
vi.mock("../../components/MeetupWeatherBadge", () => ({ MeetupWeatherBadge: () => null }));
vi.mock("../../components/MeetupTeamsPanel", () => ({ MeetupTeamsPanel: () => null }));
vi.mock("../../components/MeetupAttendancePanel", () => ({ MeetupAttendancePanel: () => null }));

const kickoff = Date.parse("2026-08-10T18:00:00Z");
const meetup = {
  id: 1,
  start_time: "2026-08-10T18:00:00",
  duration_minutes: 60,
  location: "Example pitch",
  fee: 0,
  min_players: 10,
  max_players: 15,
  latitude: null,
  longitude: null,
  waitlist_mode: "auto_promote",
  content_revision: 0,
  is_current: true,
};
const earlier = { ...meetup, id: 2, start_time: "2026-08-10T14:00:00" };
const next = { ...meetup, id: 3, start_time: "2026-08-17T18:00:00" };

async function openDashboard() {
  await act(async () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchMeetupDetail).mockImplementation(async (id) => ({
    ...(id === meetup.id ? meetup : id === earlier.id ? earlier : next),
    attendees: [],
    my_attendance: "confirmed",
    current_match: { status: "pending", match_number: 1 },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Admin match controls", () => {
  it("offers a prepared match only inside its window, even with an earlier meetup that day", async () => {
    vi.setSystemTime(kickoff - 16 * 60_000);
    vi.mocked(fetchMeetups).mockImplementation(async ({ status } = {}) => {
      const items = status === "past" ? [earlier] :
        status === "upcoming" ? [meetup] : [earlier, meetup];
      return { items, total: items.length, limit: null, offset: 0 };
    });

    await openDashboard();
    expect(fetchMeetupDetail).toHaveBeenCalledExactlyOnceWith(meetup.id);
    expect(screen.queryByRole("link", { name: "Start matches" })).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByRole("link", { name: "Start matches" })).toHaveAttribute("href", "/meetup-matches/1");

    await act(async () => vi.advanceTimersByTimeAsync(90 * 60_000 + 1));
    expect(screen.queryByRole("link", { name: "Start matches" })).not.toBeInTheDocument();
  });

  it("keeps an in-progress meetup on the overview when another is already scheduled", async () => {
    vi.setSystemTime(kickoff + 20 * 60_000);
    vi.mocked(fetchMeetupDetail).mockResolvedValue({
      ...meetup,
      attendees: [],
      my_attendance: "confirmed",
      current_match: { status: "active", match_number: 1 },
    });
    vi.mocked(fetchMeetups).mockImplementation(async ({ status } = {}) => {
      const items = status === "past" ? [meetup] :
        status === "upcoming" ? [next] : [earlier, meetup, next];
      return { items, total: items.length, limit: null, offset: 0 };
    });

    await openDashboard();
    expect(fetchMeetupDetail).toHaveBeenCalledExactlyOnceWith(meetup.id);
    expect(screen.getByRole("link", { name: "Manage match 1" })).toHaveAttribute("href", "/meetup-matches/1");
  });
});
