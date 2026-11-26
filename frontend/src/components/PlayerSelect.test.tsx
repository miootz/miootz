import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PlayerSelect, type SelectablePlayer } from "./PlayerSelect";

const players: SelectablePlayer[] = [
  { id: 1, name: "Demo Player 03" },
  { id: 2, name: "Demo Player 10" },
];

it("shows every player without a search field", () => {
  render(<PlayerSelect label="Scorer" players={players} selected={null} onSelect={vi.fn()} />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(players.length);
});

it("only selects on click so a scroll gesture does not pick a player", () => {
  const onSelect = vi.fn();
  render(<PlayerSelect label="Scorer" players={players} selected={null} onSelect={onSelect} />);
  const option = screen.getByRole("button", { name: "Demo Player 10" });
  fireEvent.mouseDown(option);
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(option);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(players[1]);
});
