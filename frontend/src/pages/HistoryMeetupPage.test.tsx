import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryMeetupPage } from "./HistoryMeetupPage";

const { fetchMeetupDetail, fetchMeetupRankings } = vi.hoisted(() => ({
  fetchMeetupDetail: vi.fn(), fetchMeetupRankings: vi.fn(),
}));

vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ me: { user: { id: 1 } } }) }));
vi.mock("../api/meetupsApi", () => ({ fetchMeetupDetail }));
vi.mock("../api/rankingsApi", () => ({ fetchMeetupRankings }));
vi.mock("../components/MeetupDetailPanel", () => ({ MeetupDetailPanel: () => <p>Meetup details</p> }));
vi.mock("../components/RankingsTable", () => ({ RankingsTable: () => <p>Match statistics</p> }));

describe("HistoryMeetupPage contributions", () => {
  beforeEach(() => {
    fetchMeetupDetail.mockReset().mockResolvedValue({ start_time: "2026-11-10T18:00:00", location: "Court", fee: 0 });
    fetchMeetupRankings.mockReset().mockResolvedValue({
      rows: [{ user: { id: 1, display_name: "Sam Vale" }, goals: 3, own_goals: 1, assists: 1, clean_sheets: 2 }],
      night: {
        kpis: { matches: 4, goals: 9, players: 1, draws: 1 },
        teams: [
          { name: "Team A", wins: 1, matches: 4, goals_for: 3, assists: 2, clean_sheets: 0 },
          { name: "Team B", wins: 3, matches: 4, goals_for: 6, assists: 4, clean_sheets: 2 },
        ],
        winning_teams: ["Team B"],
        draw_matches: [{ team_a: "Team A", team_b: "Team B", score_a: 1, score_b: 1, advancer: "Team B" }],
      },
    });
  });

  it("shows goals excluding own goals while retaining match statistics", async () => {
    render(
      <MemoryRouter initialEntries={["/history/1"]}>
        <Routes><Route path="/history/:meetupId" element={<HistoryMeetupPage />} /></Routes>
      </MemoryRouter>,
    );
    const player = await screen.findByText("Sam Vale");
    const row = player.closest("li")!;
    expect(within(row).getByTitle("Goals").previousSibling).toHaveTextContent("2");
    expect(within(row).getByTitle("Assists").previousSibling).toHaveTextContent("1");
    expect(within(row).getByTitle("Clean sheets").previousSibling).toHaveTextContent("2");
    expect(screen.getByText("Match statistics")).toBeTruthy();
    const winner = screen.getByRole("article");
    expect(within(winner).getByRole("heading", { name: "Meetup winner" })).toBeInTheDocument();
    expect(within(winner).getByRole("heading", { name: "Team B" })).toBeInTheDocument();
    expect(within(winner).getAllByRole("definition").map((stat) => stat.textContent)).toEqual(["3", "6", "4", "2"]);
    expect(screen.queryByText(/advances/)).not.toBeInTheDocument();
  });
});
