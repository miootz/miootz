import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TeamRoster } from "./TeamRoster";

it("marks above-neutral pace and dribbling and keeps zero as a rating", () => {
  render(<TeamRoster players={[
    { id: "1", name: "Alex", skillScore: 3, calculatedSkill: 0, isLocked: false, pac: 4, dri: 3 },
    { id: "2", name: "Sam", skillScore: 3, calculatedSkill: 3, isLocked: false, pac: 3, dri: 4 },
  ]} />);
  expect(screen.getAllByText("PAC")).toHaveLength(1);
  expect(screen.getAllByText("DRI")).toHaveLength(1);
  expect(screen.getByText("0.0")).toBeTruthy();
});
