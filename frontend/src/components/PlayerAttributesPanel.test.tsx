import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerAttributesPanel } from "./PlayerAttributesPanel";

describe("PlayerAttributesPanel", () => {
  it("shows evidence and distinguishes missing scores from zero counts", () => {
    render(<PlayerAttributesPanel error={null} attributes={{
      sho: { score: 3.6, count: 8, sample: 19, meetups: 4 },
      pas: { score: null, count: 0, sample: 4, total_goals: 9, meetups: 2 },
      def: { score: 3.9, count: 7, sample: 19, meetups: 4 },
      pac: 3.5,
      dri: null,
    }} />);
    expect(screen.getByText("8 open-play goals · 19 eligible matches · 4 meetups")).toBeTruthy();
    const passing = screen.getByRole("heading", { name: "Passing (PAS)" }).closest("li")!;
    expect(within(passing).getByText(/Insufficient data · 0 assists · 4 of 9/)).toBeTruthy();
    expect(within(passing).getByLabelText("Unrated")).toBeTruthy();
    expect(screen.getByText("3.5")).toBeTruthy();
    const dribbling = screen.getByRole("heading", { name: "Dribbling (DRI)" }).closest("li")!;
    expect(within(dribbling).getByText("Unrated")).toBeTruthy();
  });
});
