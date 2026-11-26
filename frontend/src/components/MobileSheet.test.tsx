import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MobileSheet } from "./MobileSheet";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

it("renders title, children and footer, and closes via the close button", () => {
  const onClose = vi.fn();
  render(
    <MobileSheet onClose={onClose} title="Test sheet" footer={<button>Primary</button>}>
      <p>Sheet body</p>
    </MobileSheet>,
  );
  expect(screen.getByRole("heading", { name: "Test sheet" })).toBeInTheDocument();
  expect(screen.getByText("Sheet body")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Primary" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledOnce();
});

it("closes on Escape", () => {
  const onClose = vi.fn();
  render(
    <MobileSheet onClose={onClose} title="Test sheet">
      <p>Body</p>
    </MobileSheet>,
  );
  // jsdom has no native cancel behavior — fire the `cancel` event the dialog would dispatch.
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
});
