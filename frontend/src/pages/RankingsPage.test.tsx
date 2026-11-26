import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { RankingsPage } from "./RankingsPage";

const { fetchRankings, fetchAttributeRankings } = vi.hoisted(() => ({
  fetchRankings: vi.fn(),
  fetchAttributeRankings: vi.fn(),
}));

vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ me: { user: { id: 1 } } }) }));
vi.mock("../api/rankingsApi", () => ({ fetchRankings, fetchAttributeRankings }));

afterEach(() => { cleanup(); sessionStorage.clear(); });

function renderRankings() {
  return render(<MemoryRouter><RankingsPage /></MemoryRouter>);
}

describe("RankingsPage attributes", () => {
  beforeEach(() => {
    fetchRankings.mockReset().mockResolvedValue({
      year: 2026, available_years: [2025, 2026], total: 0, rows: [], night: null,
      highlights: { goals: [{ user_id: 1, name: "Sam Vale", value: 8 }] },
    });
    fetchAttributeRankings.mockReset().mockResolvedValue({
      total: 26,
      rows: [{ rank: 1, user: { id: 1, display_name: "Sam Vale", avatar_url: null }, rating: 3.4, sho: 3.6, pas: null, def: 3.9 }],
    });
  });

  it("keeps highlights and requests the selected attribute, order, scope, and page", async () => {
    renderRankings();
    expect(await screen.findByText("Season highlights")).toBeTruthy();
    expect(fetchRankings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Ratings" }));
    const passing = await screen.findByRole("button", { name: "Sort by Passing" });
    const table = screen.getByRole("table", { name: "Player attribute rankings" });
    expect(table).toHaveTextContent("83");
    expect(table).toHaveTextContent("3.4");
    expect(screen.getByLabelText("Insufficient data")).toBeTruthy();
    fireEvent.click(passing);
    await waitFor(() => expect(fetchAttributeRankings).toHaveBeenLastCalledWith(
      expect.objectContaining({ year: 2026, sort: "pas", order: "desc", page: 1, perPage: 25 }),
      expect.any(AbortSignal),
    ));
    fireEvent.click(passing);
    await waitFor(() => expect(fetchAttributeRankings).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "pas", order: "asc" }), expect.any(AbortSignal),
    ));
    expect(passing.closest("th")).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(fetchAttributeRankings).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }), expect.any(AbortSignal),
    ));
    fireEvent.click(screen.getByRole("button", { name: "All time" }));
    await waitFor(() => expect(fetchAttributeRankings).toHaveBeenLastCalledWith(
      expect.objectContaining({ year: "all", page: 1 }), expect.any(AbortSignal),
    ));
  });
});

it("shows only Base Rating when computed scores are disabled", async () => {
  fetchRankings.mockResolvedValue({
    year: 2026, available_years: [2026], total: 0, rows: [], night: null, highlights: {},
  });
  fetchAttributeRankings.mockResolvedValue({
    total: 1, computed_scores: false,
    rows: [{ rank: 1, user: { id: 1, display_name: "Sam Vale", avatar_url: null }, rating: 3.4, sho: null, pas: null, def: null }],
  });
  renderRankings();
  fireEvent.click(await screen.findByRole("button", { name: "Ratings" }));
  expect(await screen.findByText("Base Rating · current")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sort by Base Rating" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sort by Passing" })).toBeNull();
  expect(screen.queryByText("How attributes work")).toBeNull();
});


it("restores the main content scroll after sorting and returning from a player", async () => {
  const row = {
    rank: 1, user: { id: 1, display_name: "Sam Vale", avatar_url: null },
    attendances: 3, goals: 1, own_goals: 0, assists: 0, clean_sheets: 0,
    goals_conceded: 0, wins: 0, losses: 0, matches: 1, win_rate: 0,
    goal_assists: 1, goals_per_match: 1, assists_per_match: 0,
    goal_assists_per_match: 1, penalties_taken: 0, penalties_scored: 0,
    penalty_conversion_rate: 0,
  };
  fetchRankings.mockReset().mockResolvedValue({
    year: 2026, available_years: [2026], total: 1, rows: [row], night: null, highlights: {},
  });
  function Player() {
    const navigate = useNavigate();
    return <button onClick={() => navigate(-1)}>Back</button>;
  }
  render(
    <MemoryRouter initialEntries={["/rankings"]}>
      <main id="main-content">
        <Routes>
          <Route path="/rankings" element={<><RankingsPage /><Link to="/player">Player</Link></>} />
          <Route path="/player" element={<Player />} />
        </Routes>
      </main>
    </MemoryRouter>,
  );
  const main = document.getElementById("main-content")!;
  await screen.findByRole("button", { name: "Sort by Goals scored" });
  main.scrollTop = 320;
  let finishSort!: (value: unknown) => void;
  const sorted = new Promise((resolve) => { finishSort = resolve; });
  fetchRankings.mockReturnValueOnce(sorted);
  fireEvent.click(screen.getByRole("button", { name: "Sort by Goals scored" }));
  main.scrollTop = 0;
  await act(async () => finishSort({
    year: 2026, available_years: [2026], total: 1, rows: [row], night: null, highlights: {},
  }));
  await waitFor(() => expect(main.scrollTop).toBe(320));
  fireEvent.click(screen.getByRole("link", { name: "Player" }));
  main.scrollTop = 0;
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("button", { name: "Sort by Goals scored" });
  await waitFor(() => expect(main.scrollTop).toBe(320));
});
