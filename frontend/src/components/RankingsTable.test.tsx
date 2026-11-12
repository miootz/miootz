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
    assists: 0,
    clean_sheets: 0,
    goals_conceded: 0,
    wins: 0,
    matches: 2,
    win_rate: 0,
    goal_assists: goals,
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
    fireEvent.click(screen.getByRole("tab", { name: "Goals scored" }));
    expect(onSortChange).toHaveBeenCalledWith("goals", "desc");
  });

  it("hides excluded columns", () => {
    render(
      <RankingsTable rows={[row(1, "A")]} excludeColumns={["attendances"]} />,
    );
    expect(screen.queryByRole("tab", { name: "Attendances" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sort by Attendances" }),
    ).toBeNull();
  });
});
