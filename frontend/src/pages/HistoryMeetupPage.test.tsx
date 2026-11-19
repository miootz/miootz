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
      night: { kpis: { matches: 4, goals: 9, players: 1, draws: 0 }, teams: [], draw_matches: [] },
    });
  });

  it("shows goals excluding own goals while retaining match statistics", async () => {
    render(
      <MemoryRouter initialEntries={["/history/1"]}>
        <Routes><Route path="/history/:meetupId" element={<HistoryMeetupPage />} /></Routes>
      </MemoryRouter>,
    );
    const player = await screen.findByRole("rowheader", { name: "Sam Vale" });
    const row = player.closest("tr")!;
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["2", "1", "2"]);
    expect(screen.getByText("Match statistics")).toBeTruthy();
  });
});
