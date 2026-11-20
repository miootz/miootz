import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { fetchMeetupTeams, patchMeetupTeams, type MeetupDetail } from "../api/meetupsApi";
import { AuthContext } from "../auth/auth-context";
import { MeetupTeamsPanel } from "./MeetupTeamsPanel";

vi.mock("../api/meetupsApi", () => ({ fetchMeetupTeams: vi.fn(), patchMeetupTeams: vi.fn() }));
vi.mock("../api/adminApi", () => ({ adminReshuffleTeams: vi.fn() }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

it("keeps team controls for upcoming meetups and hides them in history", async () => {
  vi.mocked(fetchMeetupTeams).mockResolvedValue({
    meetup_id: 7,
    content_revision: 1,
    teams: [{ id: "a", name: "A", players: [] }, { id: "b", name: "B", players: [] }],
  });
  const detail = { attendees: [], content_revision: 1 } as unknown as MeetupDetail;
  const panel = (isPast: boolean) => (
    <MemoryRouter><MeetupTeamsPanel meetupId={7} detail={detail} onChanged={vi.fn()} isPast={isPast} /></MemoryRouter>
  );
  const { rerender } = render(panel(false));
  expect(await screen.findByRole("heading", { name: "Teams" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /Team capacity/ })).toBeInTheDocument();
  expect(await screen.findAllByRole("button", { name: "Reshuffle" })).not.toHaveLength(0);

  rerender(panel(true));
  expect(screen.getByRole("heading", { name: "Starting Teams" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Team capacity/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reshuffle" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Substitutions" })).not.toBeInTheDocument();
});

it("swaps across teams after two selections and keeps player links outside substitutions", async () => {
  const alex = { id: "1", name: "Alex", skillScore: 3, isLocked: false };
  const sam = { id: "2", name: "Sam", skillScore: 3, isLocked: false };
  const jo = { id: "3", name: "Jo", skillScore: 3, isLocked: false };
  const teamA = { id: "a", name: "Team A", players: [alex, sam] };
  const teamB = { id: "b", name: "Team B", players: [jo] };
  vi.mocked(fetchMeetupTeams).mockResolvedValue({
    meetup_id: 7, content_revision: 1, teams: [teamA, teamB],
  });
  vi.mocked(patchMeetupTeams).mockClear().mockResolvedValue({
    meetup_id: 7, content_revision: 2,
    teams: [{ ...teamA, players: [alex, jo] }, { ...teamB, players: [sam] }],
  });
  const detail = { attendees: [], content_revision: 1 } as unknown as MeetupDetail;
  const onChanged = vi.fn();
  const auth = { me: { is_admin: true } } as React.ContextType<typeof AuthContext>;
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter><MeetupTeamsPanel meetupId={7} detail={detail} onChanged={onChanged} /></MemoryRouter>
    </AuthContext.Provider>,
  );

  expect(await screen.findByRole("link", { name: "Alex" })).toBeInTheDocument();
  const mode = screen.getByRole("button", { name: "Substitutions" });
  fireEvent.click(mode);
  expect(mode).toHaveAttribute("aria-pressed", "true");
  const alexButton = screen.getByRole("button", { name: "Alex" });
  fireEvent.click(alexButton);
  expect(alexButton).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(alexButton);
  expect(alexButton).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(alexButton);
  const samButton = screen.getByRole("button", { name: "Sam" });
  fireEvent.click(samButton);
  expect(samButton).toHaveAttribute("aria-pressed", "true");
  expect(patchMeetupTeams).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Jo" }));
  expect(patchMeetupTeams).toHaveBeenCalledOnce();
  expect(patchMeetupTeams).toHaveBeenCalledWith(7, [["1", "3"], ["2"]]);
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Sam" })).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(mode);
  expect(screen.getByRole("link", { name: "Alex" })).toBeInTheDocument();
});
