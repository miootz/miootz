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

it("keeps the list open on press so a scroll gesture does not pick a player", () => {
  const onSelect = vi.fn();
  const { container } = render(
    <PlayerSelect label="Scorer" players={players} selected={null} onSelect={onSelect} />,
  );
  openList();
  const option = screen.getByRole("button", { name: /Demo Player 10/ });
  fireEvent.mouseDown(option);
  expect(onSelect).not.toHaveBeenCalled();
  expect(option).toBeInTheDocument();
  fireEvent.click(option);
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(container.querySelector("ul")).toBeNull();
});
