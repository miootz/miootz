import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileScoreboard } from "./ProfileScoreboard";
import type { UserStats } from "../api/meApi";

const stats: UserStats = {
  games_played: 3,
  season_games: 2,
  season_matches: 4,
  season_goals: 5,
  season_assists: 2,
  season_clean_sheets: 1,
  season_goals_conceded: 0,
  season_wins: 3,
  season_losses: 1,
  season_win_rate: 0.75,
  season_goal_assists_per_match: 1.75,
  season_penalties_taken: 4,
  season_penalties_scored: 3,
  season_penalty_conversion_rate: 0.75,
  weather_hero_unused: 0,
  average_rating: 0,
  total_ratings: 0,
  skill_level: 0,
  goals: 0,
  assists: 0,
  clean_sheets: 0,
  goals_conceded: 0,
  wins: 0,
  matches: 0,
  win_rate: 0,
  attributes: null,
};

const penaltiesSection = () => {
  const heading = screen.getByRole("heading", { name: "Penalties" });
  return heading.parentElement!.parentElement as HTMLElement;
};

describe("ProfileScoreboard", () => {
  it("shows a dedicated Penalties section with taken/scored/conversion", () => {
    render(<ProfileScoreboard stats={stats} error={null} />);
    const section = penaltiesSection();
    expect(section.textContent).toContain("Taken");
    expect(section.textContent).toContain("Scored");
    expect(section.textContent).toContain("Conversion");
    expect(section.textContent).toContain("4");
    expect(section.textContent).toContain("3");
    expect(section.textContent).toContain("75%");
  });

  it("shows an em dash for conversion when no penalties were taken", () => {
    render(
      <ProfileScoreboard
        stats={{ ...stats, season_penalties_taken: 0, season_penalties_scored: 0, season_penalty_conversion_rate: 0 }}
        error={null}
      />,
    );
    expect(penaltiesSection().textContent).toContain("—");
  });

  it("shows the error state", () => {
    render(<ProfileScoreboard stats={null} error="boom" />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
