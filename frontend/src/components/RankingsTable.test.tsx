import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RankingsTable } from "./RankingsTable";
import type { RankingRow } from "../api/rankingsApi";

function row(rank: number, name: string, goals = 0): RankingRow {
  return {
    rank,
    user: { id: rank, display_name: name, avatar_url: null },
    attendances: 3,
    goals,
    own_goals: 0,
    assists: 0,
    clean_sheets: 0,
    goals_conceded: 0,
    wins: 0,
    losses: 2,
    matches: 2,
    win_rate: 0,
    goal_assists: goals,
    goals_per_match: goals / 2,
    assists_per_match: 0,
    goal_assists_per_match: goals / 2,
    penalties_taken: 3,
    penalties_scored: 2,
    penalty_conversion_rate: 2 / 3,
  };
}

describe("RankingsTable", () => {
  it("re-sorts descending by the selected category", () => {
    const onSortChange = vi.fn();
    render(
      <RankingsTable
        rows={[row(1, "A", 1), row(2, "B", 3)]}
        sort="attendances"
        onSortChange={onSortChange}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Rank by" }), {
      target: { value: "goal_assists_per_match" },
    });
    expect(onSortChange).toHaveBeenCalledWith("goal_assists_per_match", "desc");
  });

  it("hides excluded columns", () => {
    render(
      <RankingsTable rows={[row(1, "A")]} excludeColumns={["attendances"]} />,
    );
    expect(screen.queryByRole("option", { name: "Attendances" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sort by Attendances" }),
    ).toBeNull();
  });

  it("shows conversion and per-match rates and exposes the active sort", () => {
    const onSortChange = vi.fn();
    render(
      <RankingsTable
        rows={[row(1, "A", 1)]}
        sort="penalty_conversion_rate"
        onSortChange={onSortChange}
      />,
    );
    const sortButton = screen.getByRole("button", { name: "Sort by Penalty conversion rate" });
    expect(sortButton.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(screen.getByRole("cell", { name: "66.7%" })).toBeTruthy();
    expect(screen.getAllByRole("cell", { name: "0.50" })).toHaveLength(2);
    fireEvent.click(sortButton);
    expect(onSortChange).toHaveBeenLastCalledWith("penalty_conversion_rate", "asc");
    fireEvent.click(screen.getByRole("button", { name: "Sort by Own goals" }));
    expect(onSortChange).toHaveBeenLastCalledWith("own_goals", "desc");
  });
});
