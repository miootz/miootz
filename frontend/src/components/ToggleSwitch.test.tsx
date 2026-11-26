import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToggleSwitch } from "./ToggleSwitch";

describe("ToggleSwitch", () => {
  it("renders as a switch and reports the on/off state", () => {
    const { rerender } = render(
      <ToggleSwitch enabled={false} onChange={() => {}} ariaLabel="Notify me" />,
    );
    const sw = screen.getByRole("switch", { name: "Notify me" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    rerender(
      <ToggleSwitch enabled onChange={() => {}} ariaLabel="Notify me" />,
    );
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange on tap", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch enabled={false} onChange={onChange} ariaLabel="Toggle" />);
    fireEvent.click(screen.getByRole("switch", { name: "Toggle" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not fire onChange when disabled", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch enabled={false} disabled onChange={onChange} ariaLabel="Toggle" />);
    fireEvent.click(screen.getByRole("switch", { name: "Toggle" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
