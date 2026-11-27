import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { PitchPicker } from "./PitchPicker";

it("links both empty pitches to their referee within the demo room", () => {
  render(
    <MemoryRouter basename="/matchday" initialEntries={["/matchday/"]}>
      <PitchPicker meetupId={12} matches={[]} />
    </MemoryRouter>,
  );
  for (const pitch of [1, 2]) {
    expect(screen.getByRole("link", { name: `Pitch ${pitch} Create match` }))
      .toHaveAttribute("href", `/matchday/meetup-matches/12?pitch=${pitch}`);
  }
});
