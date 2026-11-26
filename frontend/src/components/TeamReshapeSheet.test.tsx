import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { reshapeMeetupTeams } from "../api/meetupsApi";
import { TeamReshapeSheet } from "./TeamReshapeSheet";

vi.mock("../api/meetupsApi", () => ({ reshapeMeetupTeams: vi.fn() }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

it("updates signup capacity and reopens with the saved shape for partial teams", async () => {
  const onSaved = vi.fn();
  const response = { meetup_id: 7, content_revision: 1, teams: [] };
  vi.mocked(reshapeMeetupTeams).mockResolvedValue(response);
  const props = {
    meetupId: 7, totalPlayers: 15, waitlistedPlayers: 0, teams: [], maxTeams: 3,
    currentTeamSize: 5, minPlayers: 10, maxPlayers: 15, startTime: "", hasStarted: false,
    liveMatchNumber: null, onClose: vi.fn(), onSaved,
  };
  const { unmount } = render(<TeamReshapeSheet {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "4" }));
  expect(screen.getByRole("status")).toHaveTextContent("20 signup places · 15 confirmed");
  expect(screen.getByText("Teams will have open places until more players join.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(reshapeMeetupTeams).toHaveBeenCalledWith(7, { team_count: 4, team_size: 5 }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(response, 4, 20, 5));
  unmount();

  render(<TeamReshapeSheet {...props} maxTeams={4} maxPlayers={20} />);
  expect(screen.getByRole("button", { name: "4" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Fewer players per team" }).nextElementSibling).toHaveTextContent("5");
});

it("keeps the bench after kickoff when team size is below the signup minimum", () => {
  render(<TeamReshapeSheet meetupId={7} totalPlayers={12} waitlistedPlayers={0} teams={[]}
    maxTeams={2} currentTeamSize={2} minPlayers={10} maxPlayers={10} startTime="" hasStarted
    liveMatchNumber={1} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("10 signup places · 12 confirmed · 0 waitlisted · 8 on bench");
  expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  expect(screen.getByText("Match 1 keeps its current lineup.")).toBeInTheDocument();
});

it("switches from waitlisting to bench overflow when the kickoff window opens", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(0);
    render(<TeamReshapeSheet meetupId={7} totalPlayers={15} waitlistedPlayers={1} teams={[]}
      maxTeams={3} currentTeamSize={5} minPlayers={10} maxPlayers={15}
      startTime={new Date(16 * 60_000).toISOString()} hasStarted={false}
      liveMatchNumber={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fewer players per team" }));
    expect(screen.getByRole("status")).toHaveTextContent("12 confirmed · 4 waitlisted");
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole("status")).toHaveTextContent("15 confirmed · 1 waitlisted · 3 on bench");
  } finally {
    vi.useRealTimers();
  }
});
