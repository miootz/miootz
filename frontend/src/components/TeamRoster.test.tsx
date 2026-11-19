import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TeamRoster } from "./TeamRoster";

it("marks above-neutral pace and dribbling and keeps zero as a rating", () => {
  render(<TeamRoster players={[
    { id: "1", name: "Alex", skillScore: 3, calculatedSkill: 0, isLocked: false, pac: 4, dri: 3 },
    { id: "2", name: "Sam", skillScore: 3, calculatedSkill: 3, isLocked: false, pac: 3, dri: 4 },
  ]} />);
  expect(screen.getByText("PAC")).toHaveClass("text-attribute-pac");
  expect(screen.getByText("DRI")).toHaveClass("text-attribute-dri");
  expect(screen.getByText("0.0").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});
