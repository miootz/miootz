import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RankingsPage } from "./RankingsPage";

const { fetchRankings, fetchAttributeRankings } = vi.hoisted(() => ({
  fetchRankings: vi.fn(),
  fetchAttributeRankings: vi.fn(),
}));

vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ me: { user: { id: 1 } } }) }));
vi.mock("../api/rankingsApi", () => ({ fetchRankings, fetchAttributeRankings }));

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
    render(<RankingsPage />);
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
  render(<RankingsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Ratings" }));
  expect(await screen.findByText("Base Rating · current")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sort by Base Rating" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sort by Passing" })).toBeNull();
  expect(screen.queryByText("How attributes work")).toBeNull();
});
