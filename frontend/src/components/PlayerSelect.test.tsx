import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PlayerSelect, type SelectablePlayer } from "./PlayerSelect";

const players: SelectablePlayer[] = [
  { id: 1, name: "Demo Player 03" },
  { id: 2, name: "Demo Player 10" },
];

const openList = () => {
  fireEvent.click(screen.getByRole("button", { name: "Open list" }));
};

it("selects an option on click (the touch path — phones fire click, not mousedown)", () => {
  const onSelect = vi.fn();
  const { container } = render(
    <PlayerSelect label="Scorer" players={players} selected={null} onSelect={onSelect} />,
  );
  openList();
  fireEvent.click(screen.getByText("Demo Player 03"));
  expect(onSelect).toHaveBeenCalledWith(players[0]);
  // List collapses: options gone (the parent echoes the pick into `selected`).
  expect(container.querySelector("ul")).toBeNull();
});

it("still selects on mousedown (desktop path that beats click-outside)", () => {
  const onSelect = vi.fn();
  const { container } = render(
    <PlayerSelect label="Scorer" players={players} selected={null} onSelect={onSelect} />,
  );
  openList();
  fireEvent.mouseDown(screen.getByText("Demo Player 10"));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(container.querySelector("ul")).toBeNull();
});
